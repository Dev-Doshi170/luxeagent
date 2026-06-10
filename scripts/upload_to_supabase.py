"""
upload_to_supabase.py
=====================
Uploads the balanced catalog (with embeddings) to Supabase pgvector.

Run from project root:
    python3 scripts/upload_to_supabase.py
"""

import os
import json
import pandas as pd
import numpy as np
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm

from catalog_text import extract_brand

# ── Load env ──────────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# ── Load catalog ──────────────────────────────────────────────────────────────
CATALOG_PATH = Path(__file__).parent.parent / "data" / "balanced_catalog_with_embeddings.parquet"

print("Loading catalog ...")
df = pd.read_parquet(CATALOG_PATH)
print(f"  {len(df):,} products")

# ── Connect to Supabase ───────────────────────────────────────────────────────
print("Connecting to Supabase ...")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
print("  Connected.")

# ── Upload in batches ─────────────────────────────────────────────────────────
BATCH_SIZE = 100
total = len(df)
uploaded = 0
failed = 0

print(f"\nUploading {total:,} products in batches of {BATCH_SIZE} ...")

for start in tqdm(range(0, total, BATCH_SIZE)):
    batch = df.iloc[start : start + BATCH_SIZE]
    rows = []

    for _, row in batch.iterrows():
        # Convert numpy arrays to plain lists for JSON serialization
        text_emb = row["text_embedding"]
        clip_emb = row["clip_embedding"] if "clip_embedding" in row else None

        if isinstance(text_emb, np.ndarray):
            text_emb = text_emb.tolist()
        if isinstance(clip_emb, np.ndarray):
            clip_emb = clip_emb.tolist()

        brand = row["brand"] if "brand" in row and pd.notna(row["brand"]) else extract_brand(row["productDisplayName"])

        rows.append({
            "id":              int(row["id"]),
            "name":            str(row["productDisplayName"]) if pd.notna(row["productDisplayName"]) else None,
            "brand":           str(brand) if brand else None,
            "gender":          str(row["gender"]) if pd.notna(row["gender"]) else None,
            "master_category": str(row["masterCategory"]) if pd.notna(row["masterCategory"]) else None,
            "sub_category":    str(row["subCategory"]) if pd.notna(row["subCategory"]) else None,
            "article_type":    str(row["articleType"]) if pd.notna(row["articleType"]) else None,
            "colour":          str(row["baseColour"]) if pd.notna(row["baseColour"]) else None,
            "season":          str(row["season"]) if pd.notna(row["season"]) else None,
            "usage_type":      str(row["usage"]) if pd.notna(row["usage"]) else None,
            "image_url":       str(row["link"]) if pd.notna(row["link"]) else None,
            "embedding_text":  str(row["final_embedding_text"]) if pd.notna(row["final_embedding_text"]) else None,
            "text_embedding":  text_emb,
            "clip_embedding":  clip_emb,
        })

    try:
        supabase.table("products").upsert(rows).execute()
        uploaded += len(rows)
    except Exception as e:
        print(f"\n  Batch {start}-{start+BATCH_SIZE} failed: {e}")
        failed += len(rows)

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\nDone.")
print(f"  Uploaded: {uploaded:,}")
print(f"  Failed:   {failed:,}")

# ── Verify ────────────────────────────────────────────────────────────────────
count = supabase.table("products").select("id", count="exact").execute()
print(f"  Rows in Supabase: {count.count:,}")