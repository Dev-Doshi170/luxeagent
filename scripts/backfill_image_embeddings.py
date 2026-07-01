"""
backfill_image_embeddings.py
============================
Backfills the new `image_embedding` column in the Supabase database using:
  1. Offline catalog files (balanced_catalog_with_embeddings.parquet, etc.)
  2. Fallback to existing `clip_embedding` column data in the database (since it is already populated for many products).

Run from project root:
    python3 scripts/backfill_image_embeddings.py
"""

import os
import json
import pandas as pd
import numpy as np
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm
import time

# Load env from frontend/.env
ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "frontend" / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

print("Connecting to Supabase ...")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
print("Connected.")

# Dict to hold aggregated id -> vector
embeddings_dict = {}

# 1. Load from balanced_catalog_with_embeddings.parquet
parquet1_path = ROOT / "data" / "balanced_catalog_with_embeddings.parquet"
if parquet1_path.exists():
    print(f"Loading from {parquet1_path.name} ...")
    try:
        df1 = pd.read_parquet(parquet1_path)
        for _, row in df1.iterrows():
            emb = row.get("clip_embedding")
            if emb is not None and isinstance(emb, np.ndarray) and np.any(emb):
                embeddings_dict[int(row["id"])] = emb.tolist()
        print(f"  Loaded {len(embeddings_dict)} embeddings from balanced catalog.")
    except Exception as e:
        print(f"  Error loading {parquet1_path.name}: {e}")

# 2. Load from premium_multimodal_catalog.parquet
parquet2_path = ROOT / "data" / "premium_multimodal_catalog.parquet"
if parquet2_path.exists():
    print(f"Loading from {parquet2_path.name} ...")
    try:
        df2 = pd.read_parquet(parquet2_path)
        count_added = 0
        for _, row in df2.iterrows():
            prod_id = int(row["id"])
            if prod_id not in embeddings_dict:
                emb = row.get("image_embedding")
                if emb is not None and isinstance(emb, np.ndarray) and np.any(emb):
                    embeddings_dict[prod_id] = emb.tolist()
                    count_added += 1
        print(f"  Added {count_added} embeddings from premium catalog. Total unique: {len(embeddings_dict)}")
    except Exception as e:
        print(f"  Error loading {parquet2_path.name}: {e}")

# 3. Load from image_embeddings.pkl
pkl_path = ROOT / "data" / "image_embeddings.pkl"
if pkl_path.exists():
    print(f"Loading from {pkl_path.name} ...")
    try:
        df_pkl = pd.read_pickle(pkl_path)
        count_added = 0
        for _, row in df_pkl.iterrows():
            prod_id = int(row["id"])
            if prod_id not in embeddings_dict:
                emb = row.get("image_embedding")
                if emb is not None and isinstance(emb, np.ndarray) and np.any(emb):
                    embeddings_dict[prod_id] = emb.tolist()
                    count_added += 1
        print(f"  Added {count_added} embeddings from image_embeddings.pkl. Total unique: {len(embeddings_dict)}")
    except Exception as e:
        print(f"  Error loading {pkl_path.name}: {e}")

# 4. Fetch products from database to check for existing clip_embedding values
print("\nFetching catalog IDs and existing clip_embeddings from Supabase...")
PAGE_SIZE = 1000
last_id = 0
db_embeddings_count = 0

while True:
    try:
        res = (
            supabase.table("products")
            .select("id, clip_embedding")
            .order("id")
            .gt("id", last_id)
            .range(0, PAGE_SIZE - 1)
            .execute()
        )
    except Exception as e:
        print(f"Error fetching page from database: {e}")
        break

    rows = res.data
    if not rows:
        break

    for row in rows:
        prod_id = int(row["id"])
        last_id = prod_id
        
        # If we don't have it from local files, try to parse from DB's clip_embedding
        if prod_id not in embeddings_dict:
            clip_emb_str = row.get("clip_embedding")
            if clip_emb_str:
                try:
                    # clip_embedding might be stored as string e.g. "[0.1, 0.2, ...]"
                    if isinstance(clip_emb_str, str):
                        # clean up string format if it has curly braces or brackets
                        clip_emb_str = clip_emb_str.replace("{", "[").replace("}", "]")
                        emb = json.loads(clip_emb_str)
                    elif isinstance(clip_emb_str, list):
                        emb = clip_emb_str
                    else:
                        emb = None
                    
                    if emb and len(emb) == 512:
                        embeddings_dict[prod_id] = emb
                        db_embeddings_count += 1
                except Exception as parse_err:
                    pass

    if len(rows) < PAGE_SIZE:
        break

print(f"  Parsed {db_embeddings_count} fallback embeddings from DB clip_embedding column.")
print(f"  Total embeddings ready for backfill: {len(embeddings_dict)}")

# 5. Batch update image_embedding in Supabase
BATCH_SIZE = 100
upload_items = [{"id": pid, "image_embedding": vec} for pid, vec in embeddings_dict.items()]
total_to_update = len(upload_items)

print(f"\nBackfilling {total_to_update:,} products in batches of {BATCH_SIZE}...")
success_count = 0
failed_count = 0

for start in tqdm(range(0, total_to_update, BATCH_SIZE)):
    batch = upload_items[start : start + BATCH_SIZE]
    try:
        supabase.table("products").upsert(batch).execute()
        success_count += len(batch)
    except Exception as e:
        print(f"\n  Batch {start} to {start + len(batch)} failed: {e}")
        failed_count += len(batch)
        time.sleep(1.0) # wait a moment on error

print(f"\nDone.")
print(f"  Successfully backfilled: {success_count:,}")
print(f"  Failed to backfill:       {failed_count:,}")
