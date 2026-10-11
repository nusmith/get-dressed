"""Minimal Gmail API client: OAuth code exchange, token refresh, and message reads.

Only the read-only scope is requested; the app never sends, modifies, or deletes mail.
"""

import base64
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

from api.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

# Order confirmations and receipts from the last six months.
RECEIPT_QUERY = (
    'newer_than:180d (category:purchases OR subject:("order confirmation" OR receipt '
    'OR "your order" OR "thanks for your order" OR "order #"))'
)


class GmailAuthRevoked(Exception):
    """The stored refresh token is no longer valid (user revoked access or it expired)."""


def _config() -> tuple[str, str, str]:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured on server")
    return GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI


def build_auth_url(state: str) -> str:
    client_id, _, redirect_uri = _config()
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": GMAIL_SCOPE,
        "access_type": "offline",
        # Always show consent so Google returns a refresh token on reconnect.
        "prompt": "consent",
        "include_granted_scopes": "false",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str) -> dict[str, Any]:
    client_id, client_secret, redirect_uri = _config()
    resp = httpx.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
        timeout=10.0,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Google token exchange failed: {resp.text}")
    return resp.json()


def refresh_access_token(refresh_token: str) -> str:
    client_id, client_secret, _ = _config()
    resp = httpx.post(
        GOOGLE_TOKEN_URL,
        data={
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
        },
        timeout=10.0,
    )
    if resp.status_code == 400 and "invalid_grant" in resp.text:
        raise GmailAuthRevoked()
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Google token refresh failed: {resp.text}")
    return resp.json()["access_token"]


def revoke_token(token: str) -> None:
    try:
        httpx.post(GOOGLE_REVOKE_URL, params={"token": token}, timeout=10.0)
    except Exception as exc:  # best effort; the stored token is deleted regardless
        print(f"[email] token revoke failed: {exc}")


def _get(access_token: str, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    resp = httpx.get(
        f"{GMAIL_API}{path}",
        headers={"Authorization": f"Bearer {access_token}"},
        params=params,
        timeout=15.0,
    )
    if resp.status_code == 401:
        raise GmailAuthRevoked()
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Gmail API error {resp.status_code}: {resp.text}")
    return resp.json()


def get_profile_email(access_token: str) -> str | None:
    return _get(access_token, "/profile").get("emailAddress")


def list_receipt_message_ids(access_token: str, max_results: int = 20) -> list[str]:
    data = _get(access_token, "/messages", {"q": RECEIPT_QUERY, "maxResults": max_results})
    return [m["id"] for m in data.get("messages", [])]


def _decode_body(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _collect_parts(part: dict[str, Any], html: list[str], text: list[str]) -> None:
    mime = part.get("mimeType", "")
    data = part.get("body", {}).get("data")
    if data and mime == "text/html":
        html.append(_decode_body(data))
    elif data and mime == "text/plain":
        text.append(_decode_body(data))
    for child in part.get("parts", []) or []:
        _collect_parts(child, html, text)


def get_message(access_token: str, message_id: str) -> dict[str, Any]:
    """Return {id, subject, from, date, html, text} for a message."""
    msg = _get(access_token, f"/messages/{message_id}", {"format": "full"})
    payload = msg.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    html: list[str] = []
    text: list[str] = []
    _collect_parts(payload, html, text)
    return {
        "id": message_id,
        "subject": headers.get("subject", ""),
        "from": headers.get("from", ""),
        "date": headers.get("date", ""),
        "html": "\n".join(html),
        "text": "\n".join(text),
    }
