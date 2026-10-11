from typing import Any, Literal, get_args

from fastapi import HTTPException

from api.supabase_client import supabase
from api.taxonomy import DETAIL_KEYS

# Where a closet item came from; stored as closet.metadata.source.
ClosetSource = Literal["gmail", "manual"]
CLOSET_SOURCES: frozenset[str] = frozenset(get_args(ClosetSource))


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
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")

    storage_response = None
    if image_path and image_bytes is not None:
        try:
            storage_response = supabase.storage.from_("images").upload(
                path=image_path,
                file=image_bytes,
                file_options={"content-type": content_type or "image/jpeg"},
            )
        except Exception as exc:  # pragma: no cover - simple integration error handling
            print(f"[closet] upload failed for {image_path}: {exc}")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    # persist a single closet entry (schema: id, user_id, created_at, name, image_path, metadata)
    try:
        closet_insert = supabase.table("closet").insert(
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


def user_brands(user_id: str, include_auto_filled: bool = True) -> list[str]:
    """Distinct brands on this user's closet items, sorted case-insensitively.

    include_auto_filled=False leaves out brands only filled in from photos, keeping ones the user set.
    """
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")
    rows = (
        supabase.table("closet").select("metadata").eq("user_id", user_id).not_.is_("metadata->>brand", "null").execute()
    ).data or []
    seen: dict[str, str] = {}
    for row in rows:
        metadata = row.get("metadata") or {}
        if not include_auto_filled and "brand" in (metadata.get("auto_filled") or []):
            continue
        brand = (metadata.get("brand") or "").strip()
        if brand:
            seen.setdefault(brand.lower(), brand)
    return sorted(seen.values(), key=str.lower)


def fetch_closet_rows(user_id: str) -> list[dict[str, Any]]:
    """All of this user's closet rows, newest first."""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")
    try:
        response = (
            supabase.table("closet")
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

    metadata = row.get("metadata") or {}
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "image_path": image_path,
        "image_url": image_url,
        "created_at": row.get("created_at"),
        "source": metadata.get("source"),
        **{k: metadata.get(k) for k in DETAIL_KEYS},
    }


def user_sizes(user_id: str) -> list[dict[str, str]]:
    """(category, subcategory, size) of items whose size the user set themselves, not auto-filled ones."""
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")
    rows = (
        supabase.table("closet").select("metadata").eq("user_id", user_id).not_.is_("metadata->>size", "null").execute()
    ).data or []
    sizes = []
    for row in rows:
        metadata = row.get("metadata") or {}
        if metadata.get("category") and "size" not in (metadata.get("auto_filled") or []):
            sizes.append({k: metadata.get(k) for k in ("category", "subcategory", "size")})
    return sizes
