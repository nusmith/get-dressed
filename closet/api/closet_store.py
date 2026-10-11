from typing import Any, Callable, Literal, get_args

from fastapi import HTTPException

from api.supabase_client import db, supabase
from api.taxonomy import DETAIL_KEYS

# Where a closet item came from; stored as closet.metadata.source.
ClosetSource = Literal["gmail", "manual"]
CLOSET_SOURCES: frozenset[str] = frozenset(get_args(ClosetSource))


def meta(row: dict[str, Any]) -> dict[str, Any]:
    """A closet row's metadata, never None."""
    return row.get("metadata") or {}


def style_of(row: dict[str, Any]) -> dict[str, Any]:
    """What the item's photo shows (see item_style.py), or {} until it has been described."""
    return meta(row).get("style") or {}


def save_closet_item(
    user_id: str,
    name: str,
    image_path: str | None,
    image_bytes: bytes | None,
    content_type: str | None,
    source: ClosetSource,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Upload the image (if any) to the `images` bucket and insert a closet row.

    `source` is always written to metadata.source; other metadata keys are merged alongside it.
    """
    if source not in CLOSET_SOURCES:
        raise ValueError(f"Unknown closet source {source!r}; expected one of {sorted(CLOSET_SOURCES)}")
    if metadata and "source" in metadata:
        raise ValueError("Pass source as its own argument, not inside metadata")

    storage_response = None
    if image_path and image_bytes is not None:
        try:
            storage_response = db().storage.from_("images").upload(
                path=image_path,
                file=image_bytes,
                file_options={"content-type": content_type or "image/jpeg"},
            )
        except Exception as exc:  # pragma: no cover - simple integration error handling
            print(f"[closet] upload failed for {image_path}: {exc}")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # persist a single closet entry (schema: id, user_id, created_at, name, image_path, metadata)
    try:
        closet_insert = db().table("closet").insert(
            {
                "name": name,
                "image_path": image_path,
                "user_id": user_id,
                "metadata": {"source": source, **(metadata or {})},
            }
        ).select("id,name,image_path").execute()
    except Exception as exc:  # pragma: no cover
        print(f"[closet] DB insert failed for {image_path}: {exc}")
        raise HTTPException(status_code=500, detail=f"DB insert (closet) failed: {exc}") from exc

    try:
        closet_row = closet_insert.data[0]
    except Exception:
        print(f"[closet] failed to read inserted closet row for {image_path}: {closet_insert}")
        raise HTTPException(status_code=500, detail="Failed to read inserted closet row")

    return {"closet": closet_row, "storage_response": storage_response}


def _detail_rows(user_id: str, with_field: str | None = None) -> list[dict[str, Any]]:
    """Metadata of this user's closet items (only ones with `with_field` set, if given)."""
    query = db().table("closet").select("metadata").eq("user_id", user_id)
    if with_field:
        query = query.not_.is_(f"metadata->>{with_field}", "null")
    return query.execute().data or []


def _brands(rows: list[dict[str, Any]], include_auto_filled: bool) -> list[str]:
    seen: dict[str, str] = {}
    for row in rows:
        metadata = meta(row)
        if not include_auto_filled and "brand" in (metadata.get("auto_filled") or []):
            continue
        brand = (metadata.get("brand") or "").strip()
        if brand:
            seen.setdefault(brand.lower(), brand)
    return sorted(seen.values(), key=str.lower)


def _sizes(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    sizes = []
    for row in rows:
        metadata = meta(row)
        if metadata.get("category") and metadata.get("size") and "size" not in (metadata.get("auto_filled") or []):
            sizes.append({k: metadata.get(k) for k in ("category", "subcategory", "size")})
    return sizes


def user_brands(user_id: str) -> list[str]:
    """Distinct brands on this user's closet items, sorted case-insensitively."""
    return _brands(_detail_rows(user_id, with_field="brand"), include_auto_filled=True)


def user_set_details(user_id: str) -> tuple[list[str], list[dict[str, str]]]:
    """Brands, and (category, subcategory, size) of items, that the user set themselves rather than
    ones filled in from photos. One query for both, since describing an item needs both.
    """
    rows = _detail_rows(user_id)
    return _brands(rows, include_auto_filled=False), _sizes(rows)


def fetch_closet_rows(user_id: str) -> list[dict[str, Any]]:
    """All of this user's closet rows, newest first."""
    try:
        response = (
            db().table("closet")
            .select("id,name,image_path,created_at,metadata")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"DB lookup (closet) failed: {exc}") from exc
    return response.data or []


def closet_item_payload(row: dict[str, Any]) -> dict[str, Any]:
    """A closet row as the app sees it: details flattened out of metadata, plus a 1-hour signed image URL."""
    image_path = row.get("image_path")
    image_url = None
    if image_path and supabase is not None:
        try:
            signed = supabase.storage.from_("images").create_signed_url(path=image_path, expires_in=60 * 60)
            image_url = signed.get("signedURL") or signed.get("data", {}).get("signedUrl")
        except Exception as exc:
            print(f"[closet] signed-url failed for {image_path}: {exc}")

    metadata = meta(row)
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "image_path": image_path,
        "image_url": image_url,
        "created_at": row.get("created_at"),
        "source": metadata.get("source"),
        **{k: metadata.get(k) for k in DETAIL_KEYS},
    }


def update_metadata(
    user_id: str, item_id: str, change: Callable[[dict[str, Any]], dict[str, Any]]
) -> dict[str, Any] | None:
    """Replace an item's metadata with change(current metadata), read right before writing so other
    edits made meanwhile are kept. Scoped to the owner, so nobody can touch another user's item.
    Returns the new metadata, or None when the item doesn't exist (or was deleted meanwhile).
    """
    rows = db().table("closet").select("metadata").eq("id", item_id).eq("user_id", user_id).execute().data or []
    if not rows:
        return None
    metadata = change(meta(rows[0]))
    db().table("closet").update({"metadata": metadata}).eq("id", item_id).eq("user_id", user_id).execute()
    return metadata
