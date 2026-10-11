"""Import closet items from shopping receipts in the user's Gmail.

Flow:
  1. POST /email/google/auth_url   -> signed `state` bound to the Supabase user, Google consent URL
  2. Google redirects the browser to the frontend with ?code&state
  3. POST /email/google/connect    -> verifies state belongs to the caller, stores the encrypted refresh token
  4. POST /email/scan              -> reads recent receipts, returns signed item proposals
  5. POST /email/import            -> adds the chosen proposals to the closet
"""

import hashlib
import secrets
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api import gmail
from api.auth import get_user_id_from_request
from api.closet_store import save_closet_item, user_brands
from api.email_security import decrypt_token, encrypt_token, sign, verify
from api.receipts import download_image, extract_items, normalize_item_name, retailer_from_sender
from api.supabase_client import supabase
from api.taxonomy import DETAIL_KEYS, ItemDetails, clean_item_details

router = APIRouter(prefix="/email")

STATE_TTL_SECONDS = 10 * 60
PROPOSAL_TTL_SECONDS = 24 * 60 * 60
MAX_IMPORT_BATCH = 50

_EXTENSIONS = {"image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif"}


class ConnectPayload(BaseModel):
    code: str
    state: str


class ImportProposal(BaseModel):
    token: str
    # What the user confirmed in the details modal. Omitted (e.g. "Add all") means use the
    # values the scan inferred.
    name: str | None = None
    details: ItemDetails | None = None


class ImportPayload(BaseModel):
    proposals: list[ImportProposal]


def _db():
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")
    return supabase


def _get_connection(user_id: str) -> dict[str, Any] | None:
    rows = (
        _db().table("email_connections")
        .select("email,encrypted_refresh_token,last_scanned_at")
        .eq("user_id", user_id)
        .eq("provider", "gmail")
        .execute()
    ).data or []
    return rows[0] if rows else None


def _delete_connection(user_id: str) -> None:
    _db().table("email_connections").delete().eq("user_id", user_id).eq("provider", "gmail").execute()


def _imported_keys(user_id: str) -> set[str]:
    rows = (
        _db().table("closet")
        .select("metadata")
        .eq("user_id", user_id)
        .eq("metadata->>source", "gmail")
        .execute()
    ).data or []
    return {(row.get("metadata") or {}).get("import_key") for row in rows} - {None}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/status")
def email_status(request: Request) -> dict[str, Any]:
    user_id = get_user_id_from_request(request)
    connection = _get_connection(user_id)
    if not connection:
        return {"connected": False}
    return {
        "connected": True,
        "provider": "gmail",
        "email": connection.get("email"),
        "last_scanned_at": connection.get("last_scanned_at"),
    }


@router.post("/google/auth_url")
def google_auth_url(request: Request) -> dict[str, str]:
    user_id = get_user_id_from_request(request)
    state = sign({"uid": user_id, "nonce": secrets.token_urlsafe(16), "exp": int(time.time()) + STATE_TTL_SECONDS})
    return {"url": gmail.build_auth_url(state)}


@router.post("/google/connect")
def google_connect(request: Request, payload: ConnectPayload) -> dict[str, Any]:
    user_id = get_user_id_from_request(request)
    state = verify(payload.state)
    # The state must have been issued to the same signed-in user who is completing the flow,
    # so nobody can link their Google account into someone else's closet (or vice versa).
    if state.get("uid") != user_id:
        raise HTTPException(status_code=403, detail="This Gmail connection was started by a different account")

    tokens = gmail.exchange_code(payload.code)
    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")
    if not refresh_token or not access_token:
        raise HTTPException(status_code=400, detail="Google did not return a refresh token; please try connecting again")
    if gmail.GMAIL_SCOPE not in (tokens.get("scope") or "").split():
        raise HTTPException(status_code=400, detail="Gmail read access was not granted")

    email = gmail.get_profile_email(access_token)

    # Replacing an existing connection: revoke the old grant so it does not linger.
    existing = _get_connection(user_id)
    if existing:
        gmail.revoke_token(decrypt_token(existing["encrypted_refresh_token"]))

    _db().table("email_connections").upsert(
        {
            "user_id": user_id,
            "provider": "gmail",
            "email": email,
            "encrypted_refresh_token": encrypt_token(refresh_token),
            "updated_at": _now_iso(),
        },
        on_conflict="user_id,provider",
    ).execute()

    return {"connected": True, "provider": "gmail", "email": email}


@router.delete("/connection")
def email_disconnect(request: Request) -> dict[str, Any]:
    user_id = get_user_id_from_request(request)
    connection = _get_connection(user_id)
    if connection:
        gmail.revoke_token(decrypt_token(connection["encrypted_refresh_token"]))
        _delete_connection(user_id)
    return {"connected": False}


def _scan_message(access_token: str, message_id: str) -> list[dict[str, Any]]:
    try:
        message = gmail.get_message(access_token, message_id)
        items = extract_items(message)
    except gmail.GmailAuthRevoked:
        raise
    except Exception as exc:
        print(f"[email] skipping message {message_id}: {exc}")
        return []

    retailer = retailer_from_sender(message["from"])
    return [
        {
            **item,
            "message_id": message_id,
            "retailer": retailer,
            "subject": message["subject"][:200],
            "date": message["date"],
            # Keyed by store + product (not by email) so the confirmation, shipping and delivery
            # emails for one order collapse to a single proposal and a single closet item.
            "import_key": hashlib.sha256(
                f"{retailer.lower()}:{normalize_item_name(item['name'])}".encode()
            ).hexdigest()[:32],
        }
        for item in items
    ]


@router.post("/scan")
def email_scan(request: Request) -> dict[str, Any]:
    user_id = get_user_id_from_request(request)
    connection = _get_connection(user_id)
    if not connection:
        raise HTTPException(status_code=409, detail="Gmail is not connected")

    try:
        access_token = gmail.refresh_access_token(decrypt_token(connection["encrypted_refresh_token"]))
        message_ids = gmail.list_receipt_message_ids(access_token)
        with ThreadPoolExecutor(max_workers=5) as pool:
            per_message = list(pool.map(lambda mid: _scan_message(access_token, mid), message_ids))
    except gmail.GmailAuthRevoked:
        _delete_connection(user_id)
        raise HTTPException(status_code=409, detail="Gmail access was revoked; please reconnect")

    # Messages come newest first; keep the first copy of each item, but prefer one that has a photo.
    unique: dict[str, dict[str, Any]] = {}
    for item in (item for items in per_message for item in items):
        existing = unique.get(item["import_key"])
        if existing is None:
            unique[item["import_key"]] = item
            continue
        if not existing["image_url"] and item["image_url"]:
            existing["image_url"] = item["image_url"]
        # e.g. the shipping email may state the size when the confirmation didn't.
        for k in DETAIL_KEYS:
            if not existing.get(k) and item.get(k):
                existing[k] = item[k]

    already = _imported_keys(user_id)
    expires = int(time.time()) + PROPOSAL_TTL_SECONDS
    proposals = []
    for item in unique.values():
        proposals.append(
            {
                "key": item["import_key"],
                "name": item["name"],
                "image_url": item["image_url"],
                **{k: item.get(k) for k in DETAIL_KEYS},
                "retailer": item["retailer"],
                "subject": item["subject"],
                "date": item["date"],
                "already_added": item["import_key"] in already,
                # Everything /import trusts (notably the image URL) comes from this signature,
                # so the client can't make the server fetch arbitrary URLs.
                "token": sign({"uid": user_id, "exp": expires, **item}),
            }
        )

    _db().table("email_connections").update({"last_scanned_at": _now_iso()}).eq("user_id", user_id).eq(
        "provider", "gmail"
    ).execute()

    return {"scanned_messages": len(message_ids), "proposals": proposals}


@router.post("/import")
def email_import(request: Request, payload: ImportPayload) -> dict[str, Any]:
    user_id = get_user_id_from_request(request)
    if len(payload.proposals) > MAX_IMPORT_BATCH:
        raise HTTPException(status_code=400, detail=f"Import at most {MAX_IMPORT_BATCH} items at a time")

    known_brands = user_brands(user_id)
    items = []
    for proposal in payload.proposals:
        item = verify(proposal.token)
        if item.get("uid") != user_id:
            raise HTTPException(status_code=403, detail="Proposal belongs to a different account")
        name = (proposal.name or "").strip()[:120] or item["name"]
        if proposal.details is not None:
            details = clean_item_details(proposal.details.model_dump(), known_brands=known_brands)
        else:
            details = clean_item_details(
                {k: item.get(k) for k in DETAIL_KEYS}, strict=False, known_brands=known_brands
            )
        items.append((item, name, details))

    already = _imported_keys(user_id)
    results = []
    for item, name, details in items:
        key = item["import_key"]
        if key in already:
            results.append({"key": key, "status": "already_added"})
            continue

        image_path = image_bytes = content_type = None
        image_error = None
        if item.get("image_url"):
            try:
                image_bytes, content_type = download_image(item["image_url"])
                image_path = f"email-{uuid.uuid4().hex}.{_EXTENSIONS.get(content_type, 'jpg')}"
            except Exception as exc:
                image_error = str(exc)
                print(f"[email] image download failed for {key}: {exc}")

        saved = save_closet_item(
            user_id=user_id,
            name=name,
            image_path=image_path,
            image_bytes=image_bytes,
            content_type=content_type,
            source="gmail",
            metadata={
                "import_key": key,
                "message_id": item["message_id"],
                "retailer": item["retailer"],
                "order_subject": item["subject"],
                "order_date": item["date"],
                **details,
            },
        )
        already.add(key)
        results.append({"key": key, "status": "added", "closet": saved["closet"], "image_error": image_error})

    return {"results": results}
