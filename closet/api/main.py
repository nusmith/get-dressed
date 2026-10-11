import base64
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.auth import get_user_id_from_request
from api.closet_store import closet_item_payload, fetch_closet_rows, save_closet_item, user_brands
from api.email_import import router as email_router
from api.supabase_client import supabase
from api.taxonomy import DETAIL_KEYS, ItemDetails, clean_item_details, taxonomy_payload
from api.openai_client import call_openai

app = FastAPI(title="Closet API")

# TODO clean this up and move to a config file or environment variables
allowed_origins = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:19006,http://127.0.0.1:19006,http://localhost:8081,http://127.0.0.1:8081").split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(email_router)


class UploadPayload(BaseModel):
    filename: str
    name: str
    content_type: str
    image_data: str
    user_id: str | None = None
    details: ItemDetails | None = None


class GenerateLookRequest(BaseModel):
    prompt: str
    model: str | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "closet-api"}


@app.get("/closet/taxonomy")
def get_closet_taxonomy() -> dict[str, Any]:
    return taxonomy_payload()


@app.get("/closet/brands")
def get_user_closet_brands(request: Request) -> dict[str, list[str]]:
    """Brands already used in the caller's closet, for the brand dropdown. Private to each user."""
    user_id = get_user_id_from_request(request)
    return {"brands": user_brands(user_id)}


@app.get("/closet")
def get_user_closet(request: Request) -> dict[str, Any]:
    user_id = get_user_id_from_request(request)
    return {"items": [closet_item_payload(row) for row in fetch_closet_rows(user_id)]}


class UpdateDetailsPayload(BaseModel):
    details: ItemDetails


@app.patch("/closet/{item_id}")
def update_closet_item_details(request: Request, item_id: str, payload: UpdateDetailsPayload) -> dict[str, Any]:
    """Replace an item's brand/category/subcategory/size. Name, photo and source are not editable here."""
    user_id = get_user_id_from_request(request)
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase client is not configured")

    details = clean_item_details(payload.details.model_dump(), known_brands=user_brands(user_id))

    # Scope by user_id as well as id so nobody can edit another user's item.
    rows = (
        supabase.table("closet").select("metadata").eq("id", item_id).eq("user_id", user_id).execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Closet item not found")

    # Keep everything that isn't a detail (source, Gmail import info); cleared details are removed.
    existing = rows[0].get("metadata") or {}
    metadata = {k: v for k, v in existing.items() if k not in DETAIL_KEYS} | details

    supabase.table("closet").update({"metadata": metadata}).eq("id", item_id).eq("user_id", user_id).execute()
    return {"id": item_id, **{k: details.get(k) for k in DETAIL_KEYS}}


@app.post("/upload")
def upload_image(request: Request, payload: UploadPayload) -> dict[str, Any]:
    # resolve the authenticated Supabase user id from the provided Bearer token
    user_id = get_user_id_from_request(request)
    details = (
        clean_item_details(payload.details.model_dump(), known_brands=user_brands(user_id))
        if payload.details
        else {}
    )

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
        source="manual",
        metadata=details,
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
