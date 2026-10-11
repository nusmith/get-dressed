"""Suggest an outfit from the user's own closet.

The model only sees numbered items and answers with numbers, which are mapped back to closet ids here,
so it can never invent an item. Everything it returns is re-checked: unknown numbers are dropped,
kept items are forced in, and each kind of piece appears at most once.
"""

import json
import random
from collections import Counter
from datetime import date
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from api.closet_store import closet_item_payload, meta, style_of
from api.config import OUTFIT_MODEL
from api.openai_client import call_openai_json
from api.taxonomy import EXCLUDED_CATEGORIES

MIN_CLOSET_ITEMS = 3
MAX_OUTFIT_ITEMS = 6
MAX_PROMPT_ITEMS = 400
# Some variety, so Shuffle gives a different outfit each time.
TEMPERATURE = 0.6

# Pieces that make up the body of an outfit, as opposed to shoes, bags and accessories.
GARMENT_CATEGORIES = {"Top", "Bottom", "Dress", "Outerwear", "Set", "Activewear", "Swimwear"}
MAX_SAME_COLOR_GARMENTS = 2
# How many of each category an outfit may hold; categories not listed allow one.
CATEGORY_LIMITS = {"Accessory": 2, "Jewelry": 2}
# Order pieces are shown in on the outfit card, head to toe; uncategorized items go last.
DISPLAY_ORDER = [
    "Outerwear", "Top", "Dress", "Set", "Activewear", "Swimwear", "Bottom", "Shoes", "Bag", "Accessory", "Jewelry",
]

SYSTEM_PROMPT = """You are a personal stylist putting together one outfit from the user's own closet.

Only use items from the numbered closet list. Respond with JSON only, shaped exactly like:
{"items": [<item number>, ...]}

A complete outfit is a top and a bottom, or a dress or jumpsuit, or a set, plus shoes. Add outerwear,
a bag, or up to two accessories or jewelry only when they make the outfit better. Use at most 6 items.
Never pick two items that do the same job (two pairs of shoes, two bottoms, a dress and a skirt).
If the closet has nothing for a role (for example no shoes), leave that role out.
When an item has no category, work out what it is from its name.
Each item may end with what its photo shows: colors; pattern; formality; seasons; a short note.

Pick pieces whose colors, formality and season work together and suit the occasion and any notes:
- Dress for the season today's date implies (northern hemisphere) unless the notes say otherwise.
  Skip summer-only pieces in fall and winter, or layer them under something warmer.
- Keep the whole outfit at a similar level of dressiness; match shoes to the occasion.
- A cardigan, jacket or other layer goes over a top or dress, never on its own.
- At most two garments in the same main color (no denim jacket with a denim shirt and jeans).
  The top and bottom should contrast unless it's a deliberate tonal look."""


class SuggestOutfitRequest(BaseModel):
    occasion: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=200)
    # Items that must stay in the outfit (the rest of the outfit when swapping one piece).
    keep_item_ids: list[str] = Field(default_factory=list, max_length=MAX_OUTFIT_ITEMS)
    # The piece to replace with a different one that does the same job. Never suggested again.
    swap_item_id: str | None = None
    # The outfit being shuffled away from; the new one should look noticeably different.
    previous_item_ids: list[str] = Field(default_factory=list, max_length=MAX_OUTFIT_ITEMS)
    # The user's local date, for the season. The server's date is used when it's missing.
    today: date | None = None


def _category(row: dict[str, Any]) -> str | None:
    return meta(row).get("category")


def _describe(row: dict[str, Any]) -> str:
    metadata = meta(row)
    kind = " / ".join(v for v in (metadata.get("category"), metadata.get("subcategory")) if v)
    parts = [str(row.get("name") or "Unnamed item"), kind or "no category", metadata.get("brand")]
    # What the photo shows (see item_style.py); missing until the item has been described.
    style = style_of(row)
    looks = [
        ", ".join(style.get("colors") or []),
        style.get("pattern"),
        style.get("formality"),
        "/".join(style.get("seasons") or []),
        style.get("note"),
    ]
    if any(looks):
        parts.append("; ".join(v for v in looks if v))
    return " | ".join(p for p in parts if p)


def _display_rank(row: dict[str, Any]) -> int:
    category = _category(row)
    return DISPLAY_ORDER.index(category) if category in DISPLAY_ORDER else len(DISPLAY_ORDER)


def suggest_outfit(closet_rows: list[dict[str, Any]], request: SuggestOutfitRequest) -> dict[str, Any]:
    rows = [row for row in closet_rows if _category(row) not in EXCLUDED_CATEGORIES]
    closet_count = len(rows)
    if closet_count < MIN_CLOSET_ITEMS:
        return {"items": [], "closet_count": closet_count}

    by_id = {row["id"]: row for row in rows}
    swapped = by_id.get(request.swap_item_id) if request.swap_item_id else None
    keep_ids = [i for i in dict.fromkeys(request.keep_item_ids) if i in by_id and i != request.swap_item_id]

    candidates = [row for row in rows if row["id"] != request.swap_item_id]
    random.shuffle(candidates)  # list order nudges the model; shuffling spreads its picks around
    # Kept items must be numbered even if the closet is bigger than the prompt can hold.
    candidates.sort(key=lambda row: row["id"] not in keep_ids)
    candidates = candidates[:MAX_PROMPT_ITEMS]
    number_of = {row["id"]: n for n, row in enumerate(candidates, start=1)}

    today = request.today or date.today()
    lines = [f"Today's date: {today:%A, %B} {today.day}", f"Occasion: {request.occasion or 'everyday'}"]
    if request.note and request.note.strip():
        lines.append(f"Notes from the user: {request.note.strip()}")
    if keep_ids:
        lines.append(f"The outfit must include items: {', '.join(str(number_of[i]) for i in keep_ids)}")
    if swapped:
        lines.append(
            f"Replace this piece with a different closet item that does the same job: {_describe(swapped)}"
        )
    previous = [str(number_of[i]) for i in request.previous_item_ids if i in number_of]
    if previous and not swapped:
        lines.append(f"Last outfit was items {', '.join(previous)}. Suggest something noticeably different.")
    lines.append("")
    lines.append("Closet:")
    lines.extend(f"{n}. {_describe(row)}" for n, row in enumerate(candidates, start=1))

    outfit = _pick(lines, candidates, keep_ids, by_id)
    # The model sometimes ignores the color rule, so check it and ask once more, naming the problem.
    problem = _color_problem(outfit)
    if problem:
        retry = _pick([*lines, "", f"Your last pick had {problem}. Pick again without that."], candidates, keep_ids, by_id)
        if not _color_problem(retry):
            outfit = retry

    if not outfit:
        raise HTTPException(status_code=502, detail="Couldn't put an outfit together. Try again.")

    outfit.sort(key=_display_rank)
    return {"items": [closet_item_payload(row) for row in outfit], "closet_count": closet_count}


def _color_problem(outfit: list[dict[str, Any]]) -> str | None:
    """Describes it when more garments share one main color than the prompt allows."""
    main_colors = Counter(
        colors[0]
        for row in outfit
        if _category(row) in GARMENT_CATEGORIES
        and (colors := style_of(row).get("colors"))
    )
    color, count = main_colors.most_common(1)[0] if main_colors else (None, 0)
    return f"{count} {color} garments" if count > MAX_SAME_COLOR_GARMENTS else None


def _pick(
    lines: list[str], candidates: list[dict[str, Any]], keep_ids: list[str], by_id: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Ask the model for an outfit and keep only what checks out: known items, kept ones, one per job."""
    try:
        raw = call_openai_json(
            SYSTEM_PROMPT,
            "\n".join(lines),
            model=OUTFIT_MODEL,
            temperature=TEMPERATURE,
        )
        answer = json.loads(raw)
    except (RuntimeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Couldn't put an outfit together. Try again.") from exc

    picked_numbers = answer.get("items") if isinstance(answer, dict) else None
    picked_ids: list[str] = list(keep_ids)
    for n in picked_numbers if isinstance(picked_numbers, list) else []:
        if isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= len(candidates):
            picked_ids.append(candidates[n - 1]["id"])

    outfit: list[dict[str, Any]] = []
    per_category: dict[str, int] = {}
    for item_id in dict.fromkeys(picked_ids):
        row = by_id[item_id]
        category = _category(row)
        if category:
            if per_category.get(category, 0) >= CATEGORY_LIMITS.get(category, 1):
                continue
            per_category[category] = per_category.get(category, 0) + 1
        outfit.append(row)
    return outfit[:MAX_OUTFIT_ITEMS]
