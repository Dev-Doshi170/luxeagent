"""
reembed_voyage.py - with checkpoint resume and rate-limit safe batching
"""

import os
import time
import json
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client
from tqdm import tqdm

ROOT = Path(__file__).parent.parent
CHECKPOINT_FILE = ROOT / "scripts" / ".reembed_checkpoint.json"

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env.local")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
VOYAGE_API_KEY = os.environ["VOYAGE_API_KEY"]

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
VOYAGE_MODEL = "voyage-3-lite"
EXPECTED_DIM = 512
BATCH_SIZE = 10
PAGE_SIZE = 1000
DELAY_BETWEEN_BATCHES = 3.0


def load_checkpoint() -> int:
    if CHECKPOINT_FILE.exists():
        data = json.loads(CHECKPOINT_FILE.read_text())
        return data.get("last_id", 0)
    return 0


def save_checkpoint(last_id: int) -> None:
    CHECKPOINT_FILE.write_text(json.dumps({"last_id": last_id}))


def embed_batch(texts: list[str]) -> list[list[float]]:
    for attempt in range(10):
        try:
            resp = requests.post(
                VOYAGE_URL,
                headers={
                    "Authorization": f"Bearer {VOYAGE_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"input": texts, "model": VOYAGE_MODEL},
                timeout=120,
            )
            if resp.status_code == 429:
                wait = min(2 ** attempt * 5, 120)
                print(f"\n  rate limited, waiting {wait}s ...")
                time.sleep(wait)
                continue
            if not resp.ok:
                raise RuntimeError(f"Voyage failed: {resp.status_code} {resp.text}")
            items = sorted(resp.json()["data"], key=lambda d: d["index"])
            vectors = [item["embedding"] for item in items]
            for v in vectors:
                if len(v) != EXPECTED_DIM:
                    raise RuntimeError(f"Expected {EXPECTED_DIM}-dim, got {len(v)}")
            return vectors
        except requests.exceptions.Timeout:
            wait = min(2 ** attempt * 3, 60)
            print(f"\n  timeout, waiting {wait}s ...")
            time.sleep(wait)
            continue
        except requests.exceptions.ConnectionError:
            wait = 10
            print(f"\n  connection error, waiting {wait}s ...")
            time.sleep(wait)
            continue
    raise RuntimeError("Failed after max retries.")


def main() -> None:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    last_id = load_checkpoint()
    if last_id > 0:
        print(f"Resuming from product id > {last_id}")

    total = supabase.table("products").select("id", count="exact").execute().count
    remaining = total - (last_id and supabase.table("products").select("id", count="exact").lt("id", last_id).execute().count or 0)
    print(f"Total: {total:,} | Remaining: ~{remaining:,} | Batch: {BATCH_SIZE} | Delay: {DELAY_BETWEEN_BATCHES}s")

    updated = 0

    with tqdm(total=remaining) as bar:
        while True:
            page = (
                supabase.table("products")
                .select("id, embedding_text, name")
                .order("id")
                .gt("id", last_id)
                .range(0, PAGE_SIZE - 1)
                .execute()
            )
            rows = page.data
            if not rows:
                break

            for start in range(0, len(rows), BATCH_SIZE):
                chunk = rows[start : start + BATCH_SIZE]
                texts = [(r.get("embedding_text") or r.get("name") or " ") for r in chunk]
                vectors = embed_batch(texts)

                for row, vector in zip(chunk, vectors):
                    supabase.table("products").update(
                        {"text_embedding": vector}
                    ).eq("id", row["id"]).execute()

                last_id = chunk[-1]["id"]
                save_checkpoint(last_id)
                updated += len(chunk)
                bar.update(len(chunk))
                time.sleep(DELAY_BETWEEN_BATCHES)

    CHECKPOINT_FILE.unlink(missing_ok=True)
    print(f"\nDone. Updated {updated:,} rows.")


if __name__ == "__main__":
    main()
