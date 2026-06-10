"""
generate_eval_dataset.py
========================
Generates realistic evaluation queries for evaluation.py.

Strategy:
  - Use the product's own display name as the basis for a natural query
  - Each query has exactly 1 relevant product (the one it came from)
  - Queries are written like a real user would type them
  - Covers a variety of categories, genders, and brands

This gives meaningful Recall@10 scores: did the right product appear
in the top 10? That's a question that can actually be answered well.

Output CSV format:
    query,relevant_ids
    "premium navy casual shirt for men",15970
"""

from __future__ import annotations

import argparse
import csv
import random
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).parent
DEFAULT_CATALOG_PATH = REPO_ROOT / "data" / "balanced_catalog_with_embeddings.parquet"
DEFAULT_OUTPUT_PATH  = REPO_ROOT / "evaluation_queries.csv"

# Categories to sample from — covers the full catalog breadth
SAMPLE_CATEGORIES = [
    "Shirts", "Tshirts", "Watches", "Handbags", "Sunglasses",
    "Belts", "Wallets", "Shoes", "Jeans", "Dresses",
    "Kurtas", "Jackets", "Sweaters", "Casual Shoes", "Sarees",
    "Heels", "Flats", "Sandals",
]

USAGE_ADJECTIVES = {
    "Casual":   ["casual", "everyday", "relaxed"],
    "Formal":   ["formal", "office", "professional"],
    "Sports":   ["sports", "athletic", "active"],
    "Ethnic":   ["ethnic", "traditional", "festive"],
    "Smart Casual": ["smart casual", "semi-formal"],
}

GENDER_PHRASES = {
    "Men":   ["for men", "men's"],
    "Women": ["for women", "women's"],
    "Boys":  ["for boys", "boys'"],
    "Girls": ["for girls", "girls'"],
    "Unisex": ["unisex", ""],
}


def _clean(val) -> str:
    if pd.isna(val):
        return ""
    return str(val).strip()


def _make_query(row: pd.Series, rng: random.Random) -> str:
    """
    Build a natural-language query from a product row.
    Mimics how a real user would search for this product.
    Avoids duplicate words between usage adjective and article type.
    """
    name        = _clean(row.get("productDisplayName", ""))
    colour      = _clean(row.get("baseColour", "")).lower()
    article     = _clean(row.get("articleType", "")).lower()
    usage       = _clean(row.get("usage", ""))
    gender      = _clean(row.get("gender", ""))
    brand       = _clean(row.get("brand", ""))

    parts = []

    # Optionally include brand (50% of the time)
    if brand and brand.lower() not in ("nan", "") and rng.random() < 0.5:
        parts.append(brand.lower())

    # Colour
    if colour and colour not in ("nan", ""):
        parts.append(colour)

    # Usage adjective — skip if the adjective word already appears in article type
    # e.g. don't emit "casual casual shoes"
    if usage in USAGE_ADJECTIVES:
        adjective = rng.choice(USAGE_ADJECTIVES[usage])
        adjective_words = set(adjective.lower().split())
        article_words   = set(article.lower().split())
        if not adjective_words & article_words:   # no overlap → safe to add
            parts.append(adjective)

    # Article type (always include)
    if article:
        parts.append(article)

    # Gender phrase (70% of the time)
    if gender in GENDER_PHRASES and rng.random() < 0.7:
        phrase = rng.choice([p for p in GENDER_PHRASES[gender] if p])
        if phrase:
            parts.append(phrase)

    query = " ".join(parts).strip()

    # Fallback: use first 5 words of the product name
    if not query and name:
        words = name.lower().split()
        query = " ".join(words[:5])

    return query


def generate_evaluation_rows(
    catalog: pd.DataFrame,
    query_count: int = 200,
    seed: int = 42,
) -> list[dict]:
    """
    Sample one product per query. Each query has exactly 1 relevant ID.
    Stratified across categories so the eval covers the full catalog.
    """
    rng = random.Random(seed)

    # Filter to categories we care about
    available_categories = [
        c for c in SAMPLE_CATEGORIES if c in catalog["articleType"].values
    ]

    rows = []
    seen_ids: set[int] = set()
    per_category = max(1, query_count // len(available_categories))

    for category in available_categories:
        cat_df = catalog[catalog["articleType"] == category].copy()
        sample_size = min(per_category, len(cat_df))
        sampled = cat_df.sample(n=sample_size, random_state=seed)

        for _, product in sampled.iterrows():
            product_id = int(product["id"])
            if product_id in seen_ids:
                continue
            seen_ids.add(product_id)

            query = _make_query(product, rng)
            if not query:
                continue

            rows.append({
                "query": query,
                "relevant_ids": [product_id],
            })

        if len(rows) >= query_count:
            break

    # Shuffle so categories aren't grouped
    rng.shuffle(rows)
    return rows[:query_count]


def write_evaluation_csv(rows: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["query", "relevant_ids"])
        writer.writeheader()
        for row in rows:
            relevant_ids = ",".join(str(i) for i in row["relevant_ids"])
            writer.writerow({"query": row["query"], "relevant_ids": relevant_ids})


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate realistic single-product evaluation queries."
    )
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG_PATH)
    parser.add_argument("--output",  type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--count",   type=int,  default=200,
                        help="Number of queries to generate (default: 200)")
    parser.add_argument("--seed",    type=int,  default=42)
    args = parser.parse_args()

    catalog = pd.read_parquet(args.catalog)

    # Add brand column if missing
    if "brand" not in catalog.columns:
        import sys
        sys.path.append(str(REPO_ROOT))
        from scripts.catalog_text import extract_brand
        catalog["brand"] = catalog["productDisplayName"].apply(extract_brand)

    rows = generate_evaluation_rows(catalog, query_count=args.count, seed=args.seed)
    write_evaluation_csv(rows, args.output)

    print(f"Generated {len(rows)} evaluation queries → {args.output}")
    print("\nSample queries:")
    for row in rows[:10]:
        print(f"  [{row['relevant_ids'][0]}] {row['query']}")


if __name__ == "__main__":
    main()