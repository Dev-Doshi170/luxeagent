"""
backfill_remaining_image_embeddings.py
======================================
Quickly backfills only the remaining null `image_embedding` rows in the database.
Useful for completing the backfill after dropping the invalid HNSW index.

Run from project root:
    python3 scripts/backfill_remaining_image_embeddings.py
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

# Load env
ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "frontend" / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

print("Connecting to Supabase ...")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
print("Connected.")

# 1. Fetch products where image_embedding is null
print("\nFetching products with null image_embedding from Supabase...")
PAGE_SIZE = 1000
last_id = 0
null_products = []

while True:
    try:
        res = (
            supabase.table("products")
            .select("id, clip_embedding")
            .is_("image_embedding", "null")
            .order("id")
            .gt("id", last_id)
            .range(0, PAGE_SIZE - 1)
            .execute()
        )
    except Exception as e:
        print(f"Error fetching page: {e}")
        break

    rows = res.data
    if not rows:
        break

    for row in rows:
        null_products.append(row)
        last_id = int(row["id"])

    if len(rows) < PAGE_SIZE:
        break

print(f"Found {len(null_products):,} products needing image_embedding backfill.")

if not null_products:
    print("All products are already backfilled!")
    exit(0)

# 2. Gather embeddings from local offline files
embeddings_dict = {}

# Load from balanced_catalog_with_embeddings.parquet
parquet1_path = ROOT / "data" / "balanced_catalog_with_embeddings.parquet"
if parquet1_path.exists():
    try:
        df1 = pd.read_parquet(parquet1_path)
        for _, row in df1.iterrows():
            emb = row.get("clip_embedding")
            if emb is not None and isinstance(emb, np.ndarray) and np.any(emb):
                embeddings_dict[int(row["id"])] = emb.tolist()
    except Exception as e:
        pass

# Load from premium_multimodal_catalog.parquet
parquet2_path = ROOT / "data" / "premium_multimodal_catalog.parquet"
if parquet2_path.exists():
    try:
        df2 = pd.read_parquet(parquet2_path)
        for _, row in df2.iterrows():
            prod_id = int(row["id"])
            if prod_id not in embeddings_dict:
                emb = row.get("image_embedding")
                if emb is not None and isinstance(emb, np.ndarray) and np.any(emb):
                    embeddings_dict[prod_id] = emb.tolist()
    except Exception as e:
        pass

# Load from image_embeddings.pkl
pkl_path = ROOT / "data" / "image_embeddings.pkl"
if pkl_path.exists():
    try:
        df_pkl = pd.read_pickle(pkl_path)
        for _, row in df_pkl.iterrows():
            prod_id = int(row["id"])
            if prod_id not in embeddings_dict:
                emb = row.get("image_embedding")
                if emb is not None and isinstance(emb, np.ndarray) and np.any(emb):
                    embeddings_dict[prod_id] = emb.tolist()
    except Exception as e:
        pass

# 3. Match and build backfill payload
upload_items = []
db_fallbacks = 0

for row in null_products:
    prod_id = int(row["id"])
    
    # Try local files first
    if prod_id in embeddings_dict:
        upload_items.append({"id": prod_id, "image_embedding": embeddings_dict[prod_id]})
    else:
        # Fallback to clip_embedding column
        clip_emb_str = row.get("clip_embedding")
        if clip_emb_str:
            try:
                if isinstance(clip_emb_str, str):
                    clip_emb_str = clip_emb_str.replace("{", "[").replace("}", "]")
                    emb = json.loads(clip_emb_str)
                elif isinstance(clip_emb_str, list):
                    emb = clip_emb_str
                else:
                    emb = None
                
                if emb and len(emb) == 512:
                    upload_items.append({"id": prod_id, "image_embedding": emb})
                    db_fallbacks += 1
            except:
                pass

print(f"Prepared {len(upload_items):,} items to upload (including {db_fallbacks} from DB clip_embedding fallback).")

if not upload_items:
    print("No matching embeddings found for the remaining null products.")
    exit(0)

# 4. Upsert in batches
BATCH_SIZE = 100
success_count = 0
failed_count = 0

for start in tqdm(range(0, len(upload_items), BATCH_SIZE)):
    batch = upload_items[start : start + BATCH_SIZE]
    try:
        supabase.table("products").upsert(batch).execute()
        success_count += len(batch)
    except Exception as e:
        print(f"\nBatch failed: {e}")
        failed_count += len(batch)

print(f"\nDone.")
print(f"  Successfully backfilled: {success_count:,}")
print(f"  Failed:                  {failed_count:,}")
