"""Closet item taxonomy: categories, subcategories, sizes, and suggested brands.

This is the single source of truth. The frontend loads it from GET /closet/taxonomy for its
dropdowns, the receipt scan builds its prompt from it, and clean_item_details validates against it.
"""

import re
import unicodedata
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

SIZE_GROUPS: dict[str, list[str]] = {
    "Letter": ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"],
    "Numeric": ["00", "0", "2", "4", "6", "8", "10", "12", "14", "16", "18", "20"],
    "Waist": [str(w) for w in range(23, 41)],  # denim-style 23-40; no overlap with Numeric
    "US shoe": [f"{n / 2:g}" for n in range(8, 27)],  # 4 to 13 in half sizes
    "Bra": [f"{band}{cup}" for band in range(30, 42, 2) for cup in ("A", "B", "C", "D", "DD", "DDD")],
    "Ring": [f"Ring {n / 2:g}" for n in range(8, 25)],  # 4 to 12 in half sizes
    "One size": ["One Size"],
}

# category -> (subcategories, size groups offered for that category)
CATEGORIES: dict[str, dict[str, list[str]]] = {
    "Top": {
        "subcategories": [
            "T-shirt", "Tank top", "Blouse", "Shirt", "Sweater", "Cardigan", "Sweatshirt", "Hoodie",
            "Crop top", "Bodysuit", "Camisole", "Polo", "Tunic", "Kurta",
        ],
        "size_groups": ["Letter", "Numeric"],
    },
    "Bottom": {
        "subcategories": [
            "Jeans", "Trousers", "Leggings", "Shorts", "Skirt", "Joggers", "Sweatpants", "Cargo pants",
        ],
        "size_groups": ["Letter", "Numeric", "Waist"],
    },
    "Dress": {
        "subcategories": [
            "Mini dress", "Midi dress", "Maxi dress", "Slip dress", "Shirt dress", "Sweater dress",
            "Jumpsuit", "Romper", "Saree", "Lehenga",
        ],
        "size_groups": ["Letter", "Numeric"],
    },
    "Outerwear": {
        "subcategories": [
            "Jacket", "Coat", "Blazer", "Trench coat", "Puffer", "Leather jacket", "Denim jacket",
            "Bomber jacket", "Vest", "Raincoat",
        ],
        "size_groups": ["Letter", "Numeric"],
    },
    "Set": {
        "subcategories": ["Matching set", "Suit", "Kurta set", "Sharara set", "Co-ord", "Pajama set"],
        "size_groups": ["Letter", "Numeric"],
    },
    "Shoes": {
        "subcategories": [
            "Sneakers", "High heels", "Sandals", "Flats", "Ballet flats", "Boots", "Ankle boots",
            "Loafers", "Mules", "Slides", "Wedges", "Espadrilles",
        ],
        "size_groups": ["US shoe"],
    },
    "Bag": {
        "subcategories": [
            "Tote", "Crossbody", "Shoulder bag", "Clutch", "Backpack", "Belt bag", "Top-handle bag", "Wallet",
        ],
        "size_groups": ["One size"],
    },
    "Accessory": {
        "subcategories": [
            "Hat", "Scarf", "Belt", "Sunglasses", "Gloves", "Hair accessory", "Socks", "Tie", "Watch",
        ],
        "size_groups": ["One size", "Letter"],
    },
    "Jewelry": {
        "subcategories": ["Necklace", "Earrings", "Bracelet", "Ring", "Anklet", "Brooch"],
        "size_groups": ["One size", "Ring"],
    },
    "Activewear": {
        "subcategories": ["Sports bra", "Leggings", "Shorts", "Top", "Jacket", "Sweatpants"],
        "size_groups": ["Letter"],
    },
    "Swimwear": {
        "subcategories": ["Bikini", "One-piece", "Cover-up", "Swim trunks"],
        "size_groups": ["Letter", "Numeric"],
    },
    "Intimates": {
        "subcategories": ["Bra", "Underwear", "Shapewear", "Sleepwear", "Robe", "Slip"],
        "size_groups": ["Letter", "Bra"],
    },
}

# Suggestions for the brand dropdown; any other brand is allowed too.
BRANDS: list[str] = sorted(
    [
        "& Other Stories", "Abercrombie & Fitch", "adidas", "AGOLDE", "Alo Yoga", "Anthropologie",
        "Arc'teryx", "Aritzia", "Banana Republic", "Birkenstock", "Calvin Klein", "Canada Goose",
        "Chanel", "Citizens of Humanity", "Coach", "Converse", "COS", "Cuyana", "Dior", "Dr. Martens",
        "Everlane", "Faherty", "Frame", "Free People", "Ganni", "Gap", "Gola", "Gucci", "H&M", "Hoka",
        "J.Crew", "Jeffrey Campbell", "Kate Spade", "Levi's", "Longchamp", "Louis Vuitton", "Lululemon",
        "Madewell", "Mango", "Mejuri", "Mother", "New Balance", "Nike", "On", "Patagonia", "Prada",
        "Quince", "Rag & Bone", "Ralph Lauren", "Ray-Ban", "Re/Done", "Reformation", "Saint Laurent",
        "Sam Edelman", "Sézane", "Skims", "Spanx", "Staud", "Steve Madden", "The North Face", "Theory",
        "Tommy Hilfiger", "Uniqlo", "Vans", "Veja", "Vince", "Zara",
    ],
    key=str.lower,
)

class ItemDetails(BaseModel):
    brand: str | None = None
    category: str | None = None
    subcategory: str | None = None
    size: str | None = None


MAX_BRAND_LENGTH = 80


def brand_key(brand: str) -> str:
    """Comparison key that ignores case, accents, spaces and punctuation ("Levi's" == "levis")."""
    decomposed = unicodedata.normalize("NFKD", brand)
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", without_accents.lower())
DETAIL_KEYS = ("brand", "category", "subcategory", "size")


def sizes_for(category: str) -> list[str]:
    groups = CATEGORIES.get(category, {}).get("size_groups", [])
    return [size for group in groups for size in SIZE_GROUPS[group]]


def taxonomy_payload() -> dict[str, Any]:
    return {
        "categories": [
            {
                "name": name,
                "subcategories": spec["subcategories"],
                "sizes": sizes_for(name),
            }
            for name, spec in CATEGORIES.items()
        ],
        "brands": BRANDS,
    }


def clean_item_details(
    details: dict[str, Any] | None,
    strict: bool = True,
    known_brands: list[str] | None = None,
) -> dict[str, str]:
    """Normalize brand/category/subcategory/size, dropping empty values.

    strict=True (user input) rejects invalid combinations with a 400.
    strict=False (model output) silently drops anything that doesn't fit the taxonomy.
    known_brands (the user's own brands) are matched like suggested brands, so a brand typed
    with different capitalization or punctuation reuses the spelling already in the closet.
    """

    def reject(message: str) -> None:
        if strict:
            raise HTTPException(status_code=400, detail=message)

    cleaned: dict[str, str] = {}
    details = details or {}

    brand = str(details.get("brand") or "").strip()
    if brand:
        if len(brand) > MAX_BRAND_LENGTH:
            reject(f"Brand must be at most {MAX_BRAND_LENGTH} characters")
        else:
            # Reuse an existing spelling when only case/accents/punctuation differ ("levis" ->
            # "Levi's"), preferring the user's own brands so their closet stays consistent.
            # Typo-level matches are suggested in the UI instead of merged here.
            key = brand_key(brand)
            candidates = [*(known_brands or []), *BRANDS]
            cleaned["brand"] = next((b for b in candidates if key and brand_key(b) == key), brand)

    category = str(details.get("category") or "").strip()
    subcategory = str(details.get("subcategory") or "").strip()
    size = str(details.get("size") or "").strip()

    if category and category not in CATEGORIES:
        reject(f"Unknown category {category!r}")
        category = ""
    if category:
        cleaned["category"] = category

    if subcategory:
        if not category:
            reject("Subcategory requires a category")
        elif subcategory not in CATEGORIES[category]["subcategories"]:
            reject(f"{subcategory!r} is not a {category} subcategory")
        else:
            cleaned["subcategory"] = subcategory

    if size:
        if not category:
            reject("Size requires a category")
        elif size not in sizes_for(category):
            reject(f"{size!r} is not a valid {category} size")
        else:
            cleaned["size"] = size

    return cleaned


def prompt_reference() -> str:
    """Compact taxonomy listing for the receipt-scan prompt."""
    lines = []
    for name, spec in CATEGORIES.items():
        sizes = ", ".join(sizes_for(name))
        lines.append(f"- {name}: subcategories [{', '.join(spec['subcategories'])}]; sizes [{sizes}]")
    return "\n".join(lines)
