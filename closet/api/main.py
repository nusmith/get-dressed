import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.supabase_client import supabase

app = FastAPI(title="Closet API")

# TODO clean this up and move to a config file or environment variables
allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:19006,http://127.0.0.1:19006").split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class UploadPayload(BaseModel):
    filename: str
    name: str
    content_type: str
    image_data: str
    user_id: str | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "closet-api"}


@app.post("/upload")
def upload_image(payload: UploadPayload) -> dict[str, Any]:
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")

    try:
        response = supabase.storage.from_("images").upload(
            path=payload.filename,
            file=payload.image_data,
            file_options={"content-type": payload.content_type},
        )
    except Exception as exc:  # pragma: no cover - simple integration error handling
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    # persist a single closet entry (schema: id, user_id, created_at, name, image_path, metadata)
    try:
        closet_insert = supabase.table("closet").insert(
            {
                "name": payload.name,
                "image_path": payload.filename,
                "user_id": payload.user_id,
                "metadata": None,
            }
        ).select("id,name,image_path").execute()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"DB insert (closet) failed: {exc}") from exc

    closet_row = None
    try:
        closet_row = closet_insert.get("data")[0]
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read inserted closet row")

    return {
        "status": "ok",
        "path": payload.filename,
        "name": payload.name,
        "closet": closet_row,
        "storage_response": response,
    }
