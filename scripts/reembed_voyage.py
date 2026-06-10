"""
reembed_voyage.py
=================
Re-embeds the Supabase `products.text_embedding` column with Voyage AI
`voyage-3-lite` (512-dim), replacing the old MiniLM (384-dim) vectors.

Why this exists:
  Query and document embeddings only share a vector space when they come from
  the SAME model. After switching the query-time embedder (getEmbedding) to
  Voyage, the stored MiniLM vectors are no longer comparable, so the catalog
  MUST be re-embedded with Voyage too. Run this immediately after applying
  supabase/migrations/20260610_voyage_512_text_embedding.sql.

Prereqs:
  - SUPABASE_URL, SUPABASE_SERVICE_KEY  (root .env)
  - VOYAGE_API_KEY                      (frontend/.env.local or env)

Run from project root:
    python3 scripts/reembed_voyage.py
"""

import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm

ROOT = Path(__file__).parent.parent

# Load both env files; frontend/.env.local holds VOYAGE_API_KEY.
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env.local")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
VOYAGE_API_KEY = os.environ["VOYAGE_API_KEY"]

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
VOYAGE_MODEL = "voyage-3-lite"  # 512-dim
EXPECTED_DIM = 512

# Voyage caps requests by text count and total tokens; 128 short product
# strings per request stays comfortably under both limits.
BATCH_SIZE = 128
PAGE_SIZE = 1000  # rows fetched from Supabase per page


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed up to BATCH_SIZE texts with Voyage, with simple retry."""
    for attempt in range(5):
        resp = requests.post(
            VOYAGE_URL,
            headers={
                "Authorization": f"Bearer {VOYAGE_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"input": texts, "model": VOYAGE_MODEL},
            timeout=60,
        )
        if resp.status_code == 429:
            wait = 2 ** attempt
            print(f"  rate limited, retrying in {wait}s ...")
            time.sleep(wait)
            continue
        if not resp.ok:
            raise RuntimeError(f"Voyage embedding failed: {resp.status_code} {resp.text}")
        payload = resp.json()
        # Voyage returns objects with an `index` field; sort to preserve order.
        items = sorted(payload["data"], key=lambda d: d["index"])
        vectors = [item["embedding"] for item in items]
        for v in vectors:
            if len(v) != EXPECTED_DIM:
                raise RuntimeError(
                    f"Expected {EXPECTED_DIM}-dim vectors, got {len(v)}; "
                    "check the model/column dimension match."
                )
        return vectors
    raise RuntimeError("Voyage embedding failed after retries (rate limited).")


def main() -> None:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    total = supabase.table("products").select("id", count="exact").execute().count
    print(f"Re-embedding {total:,} products with Voyage {VOYAGE_MODEL} ...")

    updated = 0
    offset = 0

    with tqdm(total=total) as bar:
        while True:
            page = (
                supabase.table("products")
                .select("id, embedding_text")
                .order("id")
                .range(offset, offset + PAGE_SIZE - 1)
                .execute()
            )
            rows = page.data
            if not rows:
                break

            for start in range(0, len(rows), BATCH_SIZE):
                chunk = rows[start : start + BATCH_SIZE]
                # Empty/None embedding_text -> fall back to name to avoid API errors.
                texts = [(r.get("embedding_text") or r.get("name") or " ") for r in chunk]
                vectors = embed_batch(texts)

                for row, vector in zip(chunk, vectors):
                    supabase.table("products").update(
                        {"text_embedding": vector}
                    ).eq("id", row["id"]).execute()

                updated += len(chunk)
                bar.update(len(chunk))

            offset += PAGE_SIZE

    print(f"\nDone. Updated {updated:,} rows.")


if __name__ == "__main__":
    main()
