"""What a user's closet says about their style, computed from saved item details and photo descriptions.

Everything here is counted from the closet; nothing is written by a model, so it stays consistent
and can't make things up.
"""

from collections import Counter
from typing import Any

from api.closet_store import meta, style_of
from api.item_style import COLORS, FORMALITY, SEASONS
from api.taxonomy import CATEGORIES, EXCLUDED_CATEGORIES

# Below this many described items, shares and gaps are too noisy to show.
MIN_DESCRIBED = 3
TOP_BRANDS = 6
# How dressy each formality level is, for "dressy pieces with nothing dressy to wear on your feet".
DRESSY = {"business", "formal"}
SMART_SHOES = {"smart casual", "business", "formal"}


def _counts(counter: Counter, order: list[str]) -> list[dict[str, Any]]:
    return [{"name": name, "count": counter[name]} for name in order]


def _gaps(rows: list[dict[str, Any]], described: list[dict[str, Any]]) -> list[str]:
    """Plain statements about what the closet is missing, from simple counts."""
    by_category = Counter(meta(row).get("category") for row in rows)
    gaps: list[str] = []

    tops, bottoms = by_category["Top"], by_category["Bottom"]
    if tops >= 3 and bottoms * 3 <= tops:
        gaps.append(f"{tops} tops but {bottoms or 'no'} bottom{'s' if bottoms != 1 else ''} to wear them with.")

    shoes = [row for row in rows if meta(row).get("category") == "Shoes"]
    dressy = [row for row in described if style_of(row).get("formality") in DRESSY]
    if not shoes:
        gaps.append("No shoes yet, so outfits will come without them.")
    elif len(dressy) >= 2 and not any(style_of(row).get("formality") in SMART_SHOES for row in shoes):
        gaps.append(f"{len(dressy)} dressy pieces, but no shoes dressy enough to go with them.")

    if not by_category["Outerwear"]:
        gaps.append("No jackets or coats.")

    winter = sum(1 for row in described if "winter" in (style_of(row).get("seasons") or []))
    if winter * 5 < len(described):
        gaps.append(f"Only {winter} of {len(described)} pieces work in winter.")

    return gaps


def analyze_closet(closet_rows: list[dict[str, Any]]) -> dict[str, Any]:
    rows = [r for r in closet_rows if meta(r).get("category") not in EXCLUDED_CATEGORIES]
    described = [row for row in rows if style_of(row).get("colors")]

    # Each item counts once, by its main color, so the shares add up to the closet.
    main_colors = Counter(style_of(row)["colors"][0] for row in described if style_of(row)["colors"][0] in COLORS)
    colors = [
        {"name": name, "hex": COLORS[name], "count": count}
        for name, count in sorted(main_colors.items(), key=lambda item: (-item[1], list(COLORS).index(item[0])))
    ]

    formality = Counter(style_of(row).get("formality") for row in described)
    seasons = Counter(season for row in described for season in style_of(row).get("seasons") or [])
    categories = Counter(meta(row).get("category") for row in rows)

    brands: Counter = Counter()
    spelling: dict[str, str] = {}
    for row in rows:
        brand = (meta(row).get("brand") or "").strip()
        if brand:
            spelling.setdefault(brand.lower(), brand)
            brands[brand.lower()] += 1

    enough = len(described) >= MIN_DESCRIBED
    return {
        "item_count": len(rows),
        "described_count": len(described),
        "colors": colors,
        "formality": _counts(formality, FORMALITY),
        "seasons": _counts(seasons, SEASONS),
        "categories": [c for c in _counts(categories, list(CATEGORIES)) if c["count"]]
        + ([{"name": "Uncategorized", "count": categories[None]}] if categories[None] else []),
        "brands": [{"name": spelling[key], "count": n} for key, n in brands.most_common(TOP_BRANDS)],
        "gaps": _gaps(rows, described) if enough else [],
    }
