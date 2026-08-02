import os
import httpx
from typing import Any

from fastapi import FastAPI, HTTPException, Request
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


def get_user_id_from_request(request: Request) -> str:
    """Validate Supabase JWT from the Authorization header and return the user id.

    This calls the Supabase Auth user endpoint which returns the user for a valid token.
    """
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth.split(" ", 1)[1].strip()
    supabase_url = os.getenv("SUPABASE_URL")
    if not supabase_url:
        raise HTTPException(status_code=500, detail="SUPABASE_URL not configured on server")

    user_endpoint = f"{supabase_url.rstrip('/')}/auth/v1/user"
    try:
        resp = httpx.get(user_endpoint, headers={"Authorization": f"Bearer {token}"}, timeout=5.0)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Auth lookup failed: {exc}") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    data = resp.json()
    user_id = data.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Failed to resolve user id from token")

    return user_id


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "closet-api"}


@app.post("/upload")
def upload_image(request: Request, payload: UploadPayload) -> dict[str, Any]:
    # resolve the authenticated Supabase user id from the provided Bearer token
    user_id = get_user_id_from_request(request)

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
                "user_id": user_id,
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
