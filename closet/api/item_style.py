"""Describe what a closet item looks like from its photo, so outfits can match colors and dressiness.

Runs in the background after an item is saved, so it never slows down the save. Items that don't
have a current description yet (older items, or ones whose run failed) are picked up when the closet
or an outfit is loaded. The result is stored as closet.metadata.style.

The same pass fills in brand, category and subcategory when the user left them empty, and the size
from the user's usual size for that kind of item, so nobody has to fill those in by hand. Details the
user set are never overwritten, and filled-in ones are listed in metadata.auto_filled.

The upload form also asks for suggestions while it's open (suggest_details). Photo results are cached,
so the background pass after saving that same photo doesn't pay for a second call.
"""

import base64
import hashlib
import json
import threading
import time
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from api.closet_store import user_brands, user_sizes
from api.openai_client import call_openai_json
from api.supabase_client import supabase
from api.taxonomy import BRANDS, CATEGORIES, brand_key, clean_item_details, sizes_for

STYLE_MODEL = "gpt-4o"
# Bump when the prompt asks for something new, so existing items are described again once.
# 2: also fills in empty brand, category and subcategory.
# 3: also fills in an empty size from the user's usual size.
# 4: colors come from COLORS, so the closet's palette can be charted.
# 5: adds light gray and COLOR_ALIASES, so near-miss colors aren't dropped.
STYLE_VERSION = 5
# Colors an item can be described with, and the swatch shown for each.
COLORS: dict[str, str] = {
    "black": "#1C1C1C", "charcoal": "#45484D", "gray": "#9A9DA2", "light gray": "#D3D5D8", "white": "#FFFFFF", "cream": "#F3EBD8",
    "beige": "#DCC9A9", "camel": "#C09A6B", "brown": "#7B5235", "navy": "#1F2A4D", "blue": "#3A6EC0",
    "light blue": "#A9C8EC", "denim": "#4F6D8F", "green": "#3F7A4A", "olive": "#6E6B3A", "sage": "#A9B79A",
    "yellow": "#EBCB4B", "orange": "#E07B39", "red": "#C2312E", "burgundy": "#6E1F2E", "pink": "#EBA1B5",
    "purple": "#6C4A9A", "lavender": "#C3B3E0", "gold": "#C9A646", "silver": "#BFC3C8",
}
# Near-misses the model sometimes answers with, mapped onto COLORS.
COLOR_ALIASES = {
    "grey": "gray", "light grey": "light gray", "dark gray": "charcoal", "dark grey": "charcoal",
    "ivory": "cream", "off-white": "cream", "off white": "cream", "tan": "camel", "khaki": "beige",
    "taupe": "beige", "maroon": "burgundy", "wine": "burgundy", "dark blue": "navy", "teal": "green",
    "mint": "sage", "blush": "pink", "lilac": "lavender", "mustard": "yellow", "rust": "orange",
}
FORMALITY = ["loungewear", "athletic", "casual", "smart casual", "business", "formal"]
SEASONS = ["spring", "summer", "fall", "winter"]
MAX_IMAGE_BYTES = 15 * 1024 * 1024
# Items described per closet load, so a big closet backfills over a few visits instead of all at once.
MAX_BACKFILL = 40
BACKFILL_WORKERS = 4
# Give up on an item after this many failed runs (until the server restarts), so a photo the model
# can't read isn't retried on every closet load.
MAX_ATTEMPTS = 2
# Quick retries within one attempt for dropped connections, which aren't the item's fault.
TRANSPORT_RETRIES = 2
# Recent photo results, keyed by photo and name, so the upload form's suggestion is reused on save.
PHOTO_CACHE_SIZE = 200

_CATEGORY_LIST = "\n".join(f"- {name}: {', '.join(spec['subcategories'])}" for name, spec in CATEGORIES.items())

SYSTEM_PROMPT = f"""You describe one clothing item or accessory from its photo, for a stylist who can't see it.

The item's name is given for context, but trust the photo for color and pattern. Photos are often mirror
selfies or someone wearing the item: describe only the garment that matches the name, never the person.
If the photo shows several products, describe the one that matches the name.

Respond with JSON only, shaped exactly like:
{{"colors": [<1 to 3 colors from {json.dumps(list(COLORS))}, main color first>],
  "pattern": "<one or two words, e.g. solid, striped, floral, plaid, graphic, animal print>",
  "formality": <one of {json.dumps(FORMALITY)}>,
  "seasons": [<the seasons it suits, from {json.dumps(SEASONS)}>],
  "note": "<under 12 words: fabric, fit, silhouette and standout details>",
  "brand": <the brand if the name states it or a logo clearly shows it, else null>,
  "category": <one category from the list below, or null>,
  "subcategory": <one subcategory listed under that category, or null>}}

Categories and their subcategories (copy them exactly):
{_CATEGORY_LIST}

Names are often typed in lowercase: "reformation white set" or "vagabond brown boots" name the brands
Reformation and Vagabond. Write the brand with its usual capitalization.
Never guess a brand from how something looks; only use one that is written in the name or the photo.

Pick the closest listed color for each; for a print, list its main colors.
Always describe the item, even when the photo is unclear; use the name to fill in what you can't see."""

_lock = threading.Lock()
_photo_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
_in_flight: set[str] = set()
_failures: dict[str, int] = {}


def _image_type(data: bytes) -> str | None:
    """Content type from the file's first bytes; uploads don't always label their type correctly."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"GIF8"):
        return "image/gif"
    return None


def _clean_style(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    names = (c.strip().lower() for c in raw.get("colors") or [] if isinstance(c, str))
    colors = list(dict.fromkeys(COLOR_ALIASES.get(name, name) for name in names))
    colors = [c for c in colors if c in COLORS][:3]
    pattern = raw.get("pattern").strip().lower()[:30] if isinstance(raw.get("pattern"), str) else ""
    formality = raw.get("formality") if raw.get("formality") in FORMALITY else None
    seasons = [s for s in SEASONS if s in (raw.get("seasons") or [])]
    note = raw.get("note").strip()[:120] if isinstance(raw.get("note"), str) else ""
    if not colors and not note:
        return None
    return {
        "colors": colors,
        "pattern": pattern or None,
        "formality": formality,
        "seasons": seasons,
        "note": note or None,
        "v": STYLE_VERSION,
    }


def _usual_size(sizes: list[dict[str, str]], category: str, subcategory: str | None) -> str | None:
    """The size the user most often picks for this subcategory (jeans, not all bottoms), else category."""
    valid = set(sizes_for(category))
    in_category = [s for s in sizes if s["category"] == category and s["size"] in valid]
    same_kind = [s for s in in_category if subcategory and s.get("subcategory") == subcategory]
    counts = Counter(s["size"] for s in same_kind or in_category)
    return counts.most_common(1)[0][0] if counts else None


def _fill_details(
    metadata: dict[str, Any], raw: Any, known_brands: list[str], sizes: list[dict[str, str]]
) -> dict[str, str]:
    """Details for fields the user left empty. A set category is never changed.

    known_brands are brands the user entered themselves. A brand is only filled in when it's one of
    those or a suggested brand, so autofill never makes one up.
    """
    if not isinstance(raw, dict):
        return {}
    guess = clean_item_details(
        {k: raw.get(k) for k in ("brand", "category", "subcategory")}, strict=False, known_brands=known_brands
    )
    fill: dict[str, str] = {}
    allowed_brands = {brand_key(b) for b in [*known_brands, *BRANDS]}
    if not metadata.get("brand") and guess.get("brand") and brand_key(guess["brand"]) in allowed_brands:
        fill["brand"] = guess["brand"]
    if not metadata.get("category") and guess.get("category"):
        fill["category"] = guess["category"]
        if guess.get("subcategory"):
            fill["subcategory"] = guess["subcategory"]
    elif (
        metadata.get("category")
        and not metadata.get("subcategory")
        and guess.get("category") == metadata["category"]
        and guess.get("subcategory")
    ):
        fill["subcategory"] = guess["subcategory"]

    category = metadata.get("category") or fill.get("category")
    if category and not metadata.get("size"):
        size = _usual_size(sizes, category, metadata.get("subcategory") or fill.get("subcategory"))
        if size:
            fill["size"] = size
    return fill


def analyze_photo(image_bytes: bytes, name: str) -> dict[str, Any]:
    """The model's raw answer for a photo: style plus brand/category/subcategory guesses."""
    content_type = _image_type(image_bytes)
    if content_type is None or len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError(f"unsupported image ({content_type or 'unknown type'}, {len(image_bytes)} bytes)")

    key = hashlib.sha256(image_bytes + b"\0" + name.strip().lower().encode()).hexdigest()
    with _lock:
        if key in _photo_cache:
            _photo_cache.move_to_end(key)
            return _photo_cache[key]

    data_url = f"data:{content_type};base64,{base64.b64encode(image_bytes).decode()}"
    content = [
        {"type": "text", "text": f"Item name: {name}"},
        {"type": "image_url", "image_url": {"url": data_url, "detail": "low"}},
    ]
    raw = json.loads(call_openai_json(SYSTEM_PROMPT, content, model=STYLE_MODEL))
    if not isinstance(raw, dict):
        raise ValueError("model returned no usable description")
    with _lock:
        _photo_cache[key] = raw
        while len(_photo_cache) > PHOTO_CACHE_SIZE:
            _photo_cache.popitem(last=False)
    return raw


def suggest_details(user_id: str, image_bytes: bytes, name: str) -> dict[str, str]:
    """Brand, category, subcategory and size to pre-fill the upload form with."""
    return _fill_details(
        {}, analyze_photo(image_bytes, name), user_brands(user_id, include_auto_filled=False), user_sizes(user_id)
    )


def _describe_once(user_id: str, item_id: str, name: str, image_path: str, image_bytes: bytes | None) -> None:
    if supabase is None:
        return
    if image_bytes is None:
        image_bytes = supabase.storage.from_("images").download(image_path)
    raw = analyze_photo(image_bytes, name)
    style = _clean_style(raw)
    if style is None:
        raise ValueError("model returned no usable description")

    # Read-modify-write right before saving, so details the user edited meanwhile are kept.
    rows = (
        supabase.table("closet").select("metadata").eq("id", item_id).eq("user_id", user_id).execute()
    ).data or []
    if not rows:
        return  # deleted while we were describing it
    existing = rows[0].get("metadata") or {}
    fill = _fill_details(existing, raw, user_brands(user_id, include_auto_filled=False), user_sizes(user_id))
    metadata = existing | fill | {"style": style}
    if fill:
        metadata["auto_filled"] = sorted(set(existing.get("auto_filled") or []) | fill.keys())
    supabase.table("closet").update({"metadata": metadata}).eq("id", item_id).eq("user_id", user_id).execute()
    _record_description(user_id, item_id, raw, style, fill)


def _record_description(
    user_id: str, item_id: str, raw: dict[str, Any], style: dict[str, Any], fill: dict[str, str]
) -> None:
    """Keep this run in item_descriptions for offline analysis. Never fails the description itself."""
    guesses = {
        f"{key}_guess": raw[key] if isinstance(raw.get(key), str) else None
        for key in ("brand", "category", "subcategory")
    }
    try:
        supabase.table("item_descriptions").insert(
            {
                "item_id": item_id,
                "user_id": user_id,
                "style_version": STYLE_VERSION,
                "model": STYLE_MODEL,
                "colors": style["colors"],
                "pattern": style["pattern"],
                "formality": style["formality"],
                "seasons": style["seasons"],
                "note": style["note"],
                **guesses,
                "filled": fill,
                "raw": raw,
            }
        ).execute()
    except Exception as exc:
        print(f"[style] recording description of {item_id} failed: {exc}")


def describe_item(user_id: str, item_id: str, name: str, image_path: str, image_bytes: bytes | None = None) -> None:
    """Describe one item's photo and store it. Never raises: this runs after the response is sent."""
    with _lock:
        if item_id in _in_flight or _failures.get(item_id, 0) >= MAX_ATTEMPTS:
            return
        _in_flight.add(item_id)
    try:
        for attempt in range(TRANSPORT_RETRIES + 1):
            try:
                _describe_once(user_id, item_id, name, image_path, image_bytes)
                break
            except httpx.TransportError:
                # Dropped connections (e.g. an HTTP/2 connection the server closed) are worth retrying.
                if attempt == TRANSPORT_RETRIES:
                    raise
                time.sleep(0.5 * (attempt + 1))
    except Exception as exc:
        with _lock:
            _failures[item_id] = _failures.get(item_id, 0) + 1
        print(f"[style] describing {item_id} failed: {exc}")
    finally:
        with _lock:
            _in_flight.discard(item_id)


def describe_missing(user_id: str, rows: list[dict[str, Any]]) -> None:
    """Describe closet rows that have a photo but no current description."""
    pending = [
        row
        for row in rows
        if row.get("image_path") and ((row.get("metadata") or {}).get("style") or {}).get("v", 1) < STYLE_VERSION
    ][:MAX_BACKFILL]
    if not pending:
        return
    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as pool:
        for row in pending:
            pool.submit(describe_item, user_id, row["id"], row.get("name") or "", row["image_path"])
