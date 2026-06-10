"""
Lightweight query expansion and tokenization for retrieval.

The expansion dictionary is intentionally small and deterministic. It improves
recall for common fashion search intents without introducing LLM latency or
unbounded query drift.
"""

from __future__ import annotations

import re


QUERY_EXPANSIONS = {
    "luxury": ["designer", "premium", "high quality"],
    "premium": ["luxury", "designer", "high quality"],
    "designer": ["luxury", "premium"],
    "handbag": ["bag", "purse", "leather handbag", "designer handbag"],
    "handbags": ["bag", "purse", "leather handbag", "designer handbag"],
    "bag": ["handbag", "purse"],
    "watch": ["timepiece", "wrist watch", "premium watch"],
    "watches": ["timepiece", "wrist watch", "premium watch"],
    "formal": ["office", "business", "dressy"],
    "office": ["formal", "business"],
    "shirt": ["shirts", "topwear", "button down"],
    "shirts": ["shirt", "topwear", "button down"],
    "tshirt": ["t-shirt", "tee", "casual top"],
    "tshirts": ["t-shirt", "tee", "casual top"],
    "t-shirt": ["tshirt", "tee", "casual top"],
    "jeans": ["denim", "blue jeans"],
    "shoes": ["footwear"],
    "sunglasses": ["shades", "eyewear"],
    "kurta": ["ethnic wear", "traditional"],
    "kurtas": ["ethnic wear", "traditional"],
    "dress": ["dresses", "gown", "party wear"],
    "dresses": ["dress", "gown", "party wear"],
}


def tokenize(text: str) -> list[str]:
    """Tokenize text for BM25 with predictable punctuation handling."""
    return re.findall(r"[a-z0-9]+", text.lower())


def expand_query(query: str, max_added_terms: int = 12) -> str:
    """Return query plus bounded fashion synonyms for embedding and BM25."""
    query = " ".join(str(query).split())
    if not query:
        return ""

    tokens = tokenize(query)
    additions: list[str] = []
    seen = {query.lower(), *tokens}

    for token in tokens:
        for expansion in QUERY_EXPANSIONS.get(token, []):
            normalized = expansion.lower()
            if normalized in seen:
                continue
            additions.append(expansion)
            seen.add(normalized)
            if len(additions) >= max_added_terms:
                return " ".join([query, *additions])

    return " ".join([query, *additions])
