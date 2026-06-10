"""
generate_clip_embeddings.py
============================
Generates CLIP image embeddings for all products in the balanced catalog
and saves them back into the parquet file.

Run from the scripts/ folder:
    python3 generate_clip_embeddings.py
"""

import numpy as np
import pandas as pd
import open_clip
import torch
from PIL import Image
from pathlib import Path
from tqdm import tqdm
import time

# ── Paths ─────────────────────────────────────────────────────────────────────
CATALOG_PATH = Path(__file__).parent.parent / "data" / "balanced_catalog_with_embeddings.parquet"
IMAGE_DIR    = Path(__file__).parent.parent / "data" / "product_images"


def _timed_clip_step(label, func):
    print(f"  CLIP before {label} ...", flush=True)
    start = time.perf_counter()
    try:
        result = func()
    except Exception as exc:
        elapsed = time.perf_counter() - start
        print(f"  CLIP failed {label} after {elapsed:.3f}s: {exc!r}", flush=True)
        raise
    elapsed = time.perf_counter() - start
    print(f"  CLIP after {label}: {elapsed:.3f}s", flush=True)
    return result

# ── Load CLIP model ───────────────────────────────────────────────────────────
print("Loading CLIP model …")
model, _, preprocess = _timed_clip_step(
    "open_clip.create_model_and_transforms",
    lambda: open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai"),
)
_timed_clip_step("model.eval", lambda: model.eval())

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"Using device: {device}", flush=True)
model = _timed_clip_step("model.to(device)", lambda: model.to(device))
_ = _timed_clip_step(
    "open_clip.get_tokenizer",
    lambda: open_clip.get_tokenizer("ViT-B-32"),
)

# ── Load catalog ──────────────────────────────────────────────────────────────
print("Loading catalog …")
df = pd.read_parquet(CATALOG_PATH)
print(f"Products: {len(df):,}")

# ── Generate CLIP embeddings ──────────────────────────────────────────────────
print("Generating CLIP embeddings …")

clip_embeddings = []
missing = 0

for product_id in tqdm(df["id"].values):
    image_path = IMAGE_DIR / f"{product_id}.jpg"

    if not image_path.exists():
        # Fallback: zero vector if image missing
        clip_embeddings.append(np.zeros(512, dtype="float32"))
        missing += 1
        continue

    try:
        image = preprocess(Image.open(image_path).convert("RGB")).unsqueeze(0).to(device)
        with torch.no_grad():
            embedding = model.encode_image(image)
            embedding = embedding / embedding.norm(dim=-1, keepdim=True)  # normalize
        clip_embeddings.append(embedding.cpu().numpy().squeeze().astype("float32"))
    except Exception as e:
        clip_embeddings.append(np.zeros(512, dtype="float32"))
        missing += 1

print(f"\nGenerated: {len(clip_embeddings) - missing:,}")
print(f"Missing/failed: {missing}")

# ── Save back to parquet ──────────────────────────────────────────────────────
print("Saving …")
df["clip_embedding"] = clip_embeddings
df.to_parquet(CATALOG_PATH, index=False)

print(f"\nDone. Saved to {CATALOG_PATH}")
print("Columns now:", df.columns.tolist())