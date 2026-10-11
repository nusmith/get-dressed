import base64
import os
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api.auth import get_user_id_from_request
from api.closet_store import closet_item_payload, fetch_closet_rows, save_closet_item, user_brands
from api.email_import import router as email_router
from api.supabase_client import supabase
from api.taxonomy import DETAIL_KEYS, ItemDetails, clean_item_details, taxonomy_payload
from api.item_style import describe_item, describe_missing, suggest_details
from api.style_analysis import analyze_closet
from api.openai_client import call_openai
from api.outfits import SuggestOutfitRequest, suggest_outfit

app = FastAPI(title="Closet API")

# About 20 MB of base64, for a photo up to the 15 MB the model is sent.
MAX_IMAGE_DATA_LENGTH = 21_000_000

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


class SuggestDetailsPayload(BaseModel):
    image_data: str = Field(max_length=MAX_IMAGE_DATA_LENGTH)
    name: str = Field(default="", max_length=200)


def decode_image_data(image_data: str) -> bytes:
    """Bytes from base64 image data, with or without a data: URL prefix."""
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    try:
        return base64.b64decode(image_data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="image_data is not valid base64") from exc


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
def get_user_closet(request: Request, background_tasks: BackgroundTasks) -> dict[str, Any]:
    user_id = get_user_id_from_request(request)
    rows = fetch_closet_rows(user_id)
    # Describe any photos that haven't been yet (older items, or a run that failed after saving).
    background_tasks.add_task(describe_missing, user_id, rows)
    return {"items": [closet_item_payload(row) for row in rows]}


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
    # Saving the details confirms them, so none count as auto-filled any more.
    metadata = {k: v for k, v in existing.items() if k not in DETAIL_KEYS and k != "auto_filled"} | details

    supabase.table("closet").update({"metadata": metadata}).eq("id", item_id).eq("user_id", user_id).execute()
    return {"id": item_id, **{k: details.get(k) for k in DETAIL_KEYS}}


@app.get("/closet/analysis")
def get_closet_analysis(request: Request, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """Colors, dressiness, seasons, categories, brands and gaps across the caller's closet."""
    user_id = get_user_id_from_request(request)
    rows = fetch_closet_rows(user_id)
    # The analysis is built from photo descriptions, so describe any that are missing for next time.
    background_tasks.add_task(describe_missing, user_id, rows)
    return analyze_closet(rows)


@app.post("/closet/suggest_details")
def suggest_closet_item_details(request: Request, payload: SuggestDetailsPayload) -> dict[str, Any]:
    """Brand, category, subcategory and size guessed from a photo, to pre-fill the upload form."""
    user_id = get_user_id_from_request(request)
    image_bytes = decode_image_data(payload.image_data)
    try:
        details = suggest_details(user_id, image_bytes, payload.name)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Couldn't read details from the photo") from exc
    return {k: details.get(k) for k in DETAIL_KEYS}


@app.post("/upload")
def upload_image(request: Request, payload: UploadPayload, background_tasks: BackgroundTasks) -> dict[str, Any]:
    # resolve the authenticated Supabase user id from the provided Bearer token
    user_id = get_user_id_from_request(request)
    details = (
        clean_item_details(payload.details.model_dump(), known_brands=user_brands(user_id))
        if payload.details
        else {}
    )

    image_bytes = decode_image_data(payload.image_data)

    saved = save_closet_item(
        user_id=user_id,
        name=payload.name,
        image_path=payload.filename,
        image_bytes=image_bytes,
        content_type=payload.content_type,
        source="manual",
        metadata=details,
    )
    # Runs after the response is sent, so describing the photo doesn't slow the upload down.
    background_tasks.add_task(
        describe_item, user_id, saved["closet"]["id"], payload.name, payload.filename, image_bytes
    )

    return {
        "status": "ok",
        "path": payload.filename,
        "name": payload.name,
        "closet": saved["closet"],
        "storage_response": saved["storage_response"],
    }


@app.post("/outfits/suggest")
def suggest_user_outfit(
    request: Request, payload: SuggestOutfitRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    """One outfit from the caller's closet. Also used to shuffle it or swap out a single piece."""
    user_id = get_user_id_from_request(request)
    rows = fetch_closet_rows(user_id)
    # Undescribed items are picked by name alone; describe them for next time.
    background_tasks.add_task(describe_missing, user_id, rows)
    return suggest_outfit(rows, payload)


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
