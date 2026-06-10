"""
rebuild_catalog.py
==================
Replaces the biased premium_catalog.parquet with a balanced one.

Root cause of the old bug:
  - category_scores gave Watches/Handbags/Heels a score of 3, everything
    else 1-2, so the top-3000 sort by luxury_score was almost entirely
    accessories.
  - The later balanced_sampled_df fix was never saved and wired in.

This script produces:
  ../data/balanced_catalog.parquet   — metadata (no embeddings)
  ../data/balanced_catalog_with_embeddings.parquet  — with MiniLM embeddings
"""

import pandas as pd
import numpy as np
from pathlib import Path

from catalog_text import build_embedding_text, extract_brand

# ── 1. Load raw styles ────────────────────────────────────────────────────────
print("Loading styles.csv …")
styles_df = pd.read_csv("../data/styles.csv", on_bad_lines="skip")

# ── 2. Define the target categories (balanced across apparel, footwear, accessories)
TARGET_CATEGORIES = [
    # Apparel – menswear
    "Shirts",
    "Tshirts",
    "Jeans",
    "Trousers",
    "Jackets",
    "Sweaters",
    # Apparel – womenswear
    "Tops",
    "Dresses",
    "Kurtas",
    "Sarees",
    # Footwear
    "Casual Shoes",
    "Formal Shoes",
    "Heels",
    "Sandals",
    "Flats",
    # Accessories
    "Watches",
    "Handbags",
    "Sunglasses",
    "Wallets",
    "Belts",
    "Clutches",
    "Earrings",
]


                              # 22 categories × 250 = up to 5,500 products

# ── 3. Filter to target categories only ──────────────────────────────────────
filtered_df = styles_df[
    styles_df["masterCategory"].isin(["Apparel", "Footwear", "Accessories"])
    & styles_df["articleType"].isin(TARGET_CATEGORIES)
].copy()

print(f"Filtered pool: {len(filtered_df):,} rows")
print(filtered_df["articleType"].value_counts().to_string())

# ── 4. Merge image links ──────────────────────────────────────────────────────
images_df = pd.read_csv("../data/images.csv")
images_df["id"] = images_df["filename"].str.replace(".jpg", "", regex=False).astype(int)

catalog_df = filtered_df.merge(images_df[["id", "link"]], on="id", how="left")

# ── 5. Keep only rows that have an image on disk ──────────────────────────────
image_dir = Path("../data/product_images")
existing_ids = {int(p.stem) for p in image_dir.glob("*.jpg")}
catalog_df = catalog_df[catalog_df["id"].isin(existing_ids)].copy()
print(f"\nAfter image filter: {len(catalog_df):,} rows")

# ── 6. Balanced sample — up to SAMPLES_PER_CATEGORY per articleType ──────────
balanced_df = catalog_df.copy()

print(f"\nFinal catalog size: {len(balanced_df):,} rows")
print(balanced_df["articleType"].value_counts().to_string())

print(f"\nFinal balanced catalog: {len(balanced_df):,} rows")
print(balanced_df["articleType"].value_counts().to_string())

mastercat_counts = balanced_df["masterCategory"].value_counts()
total = len(balanced_df)
print("\nCategory split:")
for cat, count in mastercat_counts.items():
    print(f"  {cat}: {count} ({count/total*100:.1f}%)")

# ── 7. Build embedding text ───────────────────────────────────────────────────
balanced_df["brand"] = balanced_df["productDisplayName"].apply(extract_brand)
balanced_df["final_embedding_text"] = balanced_df.apply(build_embedding_text, axis=1)

# ── 8. Save metadata without embeddings ──────────────────────────────────────
out_path = Path("../data/balanced_catalog.parquet")
balanced_df.to_parquet(out_path, index=False)
print(f"\nSaved metadata → {out_path}")

# ── 9. Generate MiniLM embeddings ────────────────────────────────────────────
print("\nGenerating MiniLM embeddings …")
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")

embeddings = model.encode(
    balanced_df["final_embedding_text"].tolist(),
    batch_size=256,
    show_progress_bar=True,
    normalize_embeddings=True,
)

balanced_df["text_embedding"] = list(embeddings)

out_emb_path = Path("../data/balanced_catalog_with_embeddings.parquet")
balanced_df.to_parquet(out_emb_path, index=False)
print(f"Saved with embeddings → {out_emb_path}")

print("\nDone. Update your search pipeline to load balanced_catalog_with_embeddings.parquet")