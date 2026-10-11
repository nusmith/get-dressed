from typing import Any

from fastapi import HTTPException

from api.supabase_client import supabase


def save_closet_item(
    user_id: str,
    name: str,
    image_path: str | None,
    image_bytes: bytes | None,
    content_type: str | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Upload the image (if any) to the `images` bucket and insert a closet row."""
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
                "metadata": metadata,
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
