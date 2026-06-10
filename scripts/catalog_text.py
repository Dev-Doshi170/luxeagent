"""
Catalog text helpers for retrieval.

These helpers keep brand extraction and embedding-text generation deterministic so
the local parquet catalog, Supabase upload, and offline evaluation all describe
products the same way.
"""

from __future__ import annotations

import re
from typing import Mapping, Any


KNOWN_BRANDS = [
    "Peter England",
    "U.S. Polo Assn",
    "U.S. Polo",
    "US Polo",
    "United Colors of Benetton",
    "Marks & Spencer",
    "Van Heusen",
    "Park Avenue",
    "Louis Vuitton",
    "Michael Kors",
    "Kate Spade",
    "Ralph Lauren",
    "Tommy Hilfiger",
    "Calvin Klein",
    "Hugo Boss",
    "Fabindia",
    "Inkfruit",
    "Manchester United",
    "Puma",
    "Titan",
    "Skagen",
    "Gucci",
    "Prada",
    "Chanel",
    "Hermes",
    "Versace",
    "Burberry",
    "Dior",
    "Fendi",
    "Givenchy",
    "Balenciaga",
    "Valentino",
    "Coach",
    "Diesel",
    "Armani",
    "Levi's",
    "Levis",
    "Zara",
    "Mango",
    "Forever 21",
    "H&M",
    "Arrow",
    "Raymond",
]

BRAND_BOUNDARY_TOKENS = {
    "men",
    "mens",
    "men's",
    "women",
    "womens",
    "women's",
    "boys",
    "boy",
    "girls",
    "girl",
    "kids",
    "unisex",
}

DESCRIPTOR_START_TOKENS = {
    "black",
    "blue",
    "brown",
    "green",
    "grey",
    "gray",
    "navy",
    "orange",
    "pink",
    "purple",
    "red",
    "silver",
    "white",
    "yellow",
    "gold",
    "beige",
    "casual",
    "formal",
    "slim",
    "regular",
    "solid",
    "striped",
    "printed",
}

ARTICLE_SINGULARS = {
    "shirts": "shirt",
    "tshirts": "t-shirt",
    "tops": "top",
    "jeans": "jeans",
    "trousers": "trousers",
    "jackets": "jacket",
    "sweaters": "sweater",
    "dresses": "dress",
    "kurtas": "kurta",
    "sarees": "saree",
    "casual shoes": "casual shoe",
    "formal shoes": "formal shoe",
    "heels": "heels",
    "sandals": "sandals",
    "flats": "flats",
    "watches": "watch",
    "handbags": "handbag",
    "sunglasses": "sunglasses",
    "wallets": "wallet",
    "belts": "belt",
    "clutches": "clutch",
    "earrings": "earrings",
}


def _clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return ""
    return re.sub(r"\s+", " ", text)


def _possessive_gender(gender: str) -> str:
    gender_lower = gender.lower()
    if gender_lower == "men":
        return "men's"
    if gender_lower == "women":
        return "women's"
    if gender_lower in {"boys", "girls"}:
        return f"{gender_lower}'"
    return gender_lower


def _article_phrase(article_type: str) -> str:
    return ARTICLE_SINGULARS.get(article_type.lower(), article_type.lower())


def extract_brand(product_display_name: Any) -> str:
    """Extract a conservative brand prefix from a product display name."""
    name = _clean(product_display_name)
    if not name:
        return ""

    name_lower = name.lower()
    for brand in sorted(KNOWN_BRANDS, key=len, reverse=True):
        if name_lower.startswith(brand.lower()):
            return brand

    words = name.split()
    first_word = words[0]
    normalized_first = re.sub(r"[^A-Za-z&.']", "", first_word).lower()
    if normalized_first in BRAND_BOUNDARY_TOKENS or normalized_first in DESCRIPTOR_START_TOKENS:
        return ""
    return first_word


def build_embedding_text(row: Mapping[str, Any]) -> str:
    """Build a rich natural-language catalog description for retrieval."""
    name = _clean(row.get("productDisplayName"))
    brand = _clean(row.get("brand")) or extract_brand(name)
    gender = _clean(row.get("gender"))
    master_category = _clean(row.get("masterCategory"))
    sub_category = _clean(row.get("subCategory"))
    article_type = _clean(row.get("articleType"))
    color = _clean(row.get("baseColour"))
    season = _clean(row.get("season"))
    usage = _clean(row.get("usage"))

    descriptor_parts = []
    if brand:
        descriptor_parts.append(brand)
    if gender:
        descriptor_parts.append(_possessive_gender(gender))
    if color:
        descriptor_parts.append(color.lower())
    if usage:
        descriptor_parts.append(usage.lower())
    if article_type:
        descriptor_parts.append(_article_phrase(article_type))

    primary_sentence = " ".join(descriptor_parts).strip()
    if primary_sentence:
        primary_sentence = f"{primary_sentence}."
    elif name:
        primary_sentence = f"{name}."

    details = []
    if name:
        details.append(f"Product name: {name}.")
    if brand:
        details.append(f"Brand: {brand}.")
    if article_type:
        details.append(f"Category: {article_type}.")
    if sub_category:
        details.append(f"Subcategory: {sub_category}.")
    if master_category:
        details.append(f"Master category: {master_category}.")
    if color:
        details.append(f"Color: {color}.")
    if season:
        details.append(f"Season: {season}.")
    if usage:
        details.append(f"Intended usage: {usage} fashion.")

    return " ".join([primary_sentence, *details]).strip()
