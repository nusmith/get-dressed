import base64
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.auth import get_user_id_from_request
from api.closet_store import save_closet_item
from api.email_import import router as email_router
from api.supabase_client import supabase
from api.openai_client import call_openai

app = FastAPI(title="Closet API")

# TODO clean this up and move to a config file or environment variables
allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:19006,http://127.0.0.1:19006,http://localhost:8081,http://127.0.0.1:8081").split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(email_router)


class UploadPayload(BaseModel):
    filename: str
    name: str
    content_type: str
    image_data: str
    user_id: str | None = None


class GenerateLookRequest(BaseModel):
    prompt: str
    model: str | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "closet-api"}


@app.get("/closet")
def get_user_closet(request: Request) -> dict[str, Any]:
    user_id = get_user_id_from_request(request)

    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")

    try:
        response = (
            supabase.table("closet")
            .select("id,name,image_path,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"DB lookup (closet) failed: {exc}") from exc

    rows = response.data or []
    items: list[dict[str, Any]] = []

    for row in rows:
        image_path = row.get("image_path")
        image_url = None

        if image_path:
            try:
                signed = supabase.storage.from_("images").create_signed_url(path=image_path, expires_in=60 * 60)
                image_url = signed.get("signedURL") or signed.get("data", {}).get("signedUrl")
            except Exception as exc:
                image_url = None
                print(f"[closet] signed-url failed for {image_path}: {exc}")

        items.append(
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "image_path": image_path,
                "image_url": image_url,
                "created_at": row.get("created_at"),
            }
        )

    return {"items": items}


@app.post("/upload")
def upload_image(request: Request, payload: UploadPayload) -> dict[str, Any]:
    # resolve the authenticated Supabase user id from the provided Bearer token
    user_id = get_user_id_from_request(request)

    image_data = payload.image_data
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    try:
        image_bytes = base64.b64decode(image_data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="image_data is not valid base64") from exc

    saved = save_closet_item(
        user_id=user_id,
        name=payload.name,
        image_path=payload.filename,
        image_bytes=image_bytes,
        content_type=payload.content_type,
    )

    return {
        "status": "ok",
        "path": payload.filename,
        "name": payload.name,
        "closet": saved["closet"],
        "storage_response": saved["storage_response"],
    }


@app.post("/generate_look")
def generate_look(request: Request, payload: GenerateLookRequest) -> dict[str, Any]:
    """Proxy endpoint to call OpenAI from the server side using OPENAI_API_KEY."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured on server")

    try:
        result = call_openai(payload.prompt, model=payload.model or "gpt-4o-mini", api_key=api_key)
    except Exception as exc:  # pragma: no cover - surface API errors
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"result": result}
