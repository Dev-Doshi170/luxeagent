"""
search.py
=========
Hybrid search for LuxeAgent.

Scoring formula:
  If CLIP embeddings are present:
    final_score = (
        0.50 * semantic_score
      + 0.20 * bm25_score
      + 0.20 * clip_score
      + 0.10 * luxury_score
    )

  Otherwise:
    final_score = (
        0.60 * semantic_score
      + 0.25 * bm25_score
      + 0.15 * luxury_score
    )

Pipeline with reranker:
  1. Hybrid retrieval → top RERANK_FETCH candidates
  2. Cross-encoder reranker → top_k final results

Note: CLIP embeddings are stored in the catalog and will be used
      for image-based search in a future endpoint. Excluded from
      text query scoring due to Python 3.13 / PyTorch MPS segfault.
"""

import os
import sys
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
os.environ["PYTORCH_NO_MPS"] = "1"

import numpy as np
import pandas as pd
import faiss
from sentence_transformers import SentenceTransformer
from rank_bm25 import BM25Okapi
from pathlib import Path
import time

try:
    import open_clip
    import torch
except Exception:
    open_clip = None
    torch = None

try:
    from .query_expansion import expand_query, tokenize
    from .scoring import combine_scores
    from .reranker import rerank
    from scripts.catalog_text import extract_brand
except ImportError:
    from query_expansion import expand_query, tokenize
    from scoring import combine_scores
    from reranker import rerank
    sys.path.append(str(Path(__file__).parent.parent))
    from scripts.catalog_text import extract_brand

# ── Paths ─────────────────────────────────────────────────────────────────────
CATALOG_PATH = Path(__file__).parent.parent / "data" / "balanced_catalog_with_embeddings.parquet"
ENABLE_CLIP = os.getenv("LUXE_ENABLE_CLIP", "").lower() in {"1", "true", "yes", "on"}

# How many candidates to fetch before reranking
# Wider net = better recall, but slightly slower reranking
RERANK_FETCH = 50

# ── Luxury brand list ─────────────────────────────────────────────────────────
LUXURY_BRANDS = {
    "high":  ["gucci", "prada", "louis vuitton", "chanel", "hermes", "versace",
              "burberry", "dior", "fendi", "givenchy", "balenciaga", "valentino"],
    "mid":   ["ralph lauren", "tommy hilfiger", "calvin klein", "michael kors",
              "coach", "kate spade", "diesel", "armani", "hugo boss",
              "u.s. polo", "us polo", "levis", "levi's"],
    "entry": ["zara", "mango", "forever 21", "h&m", "marks & spencer",
              "peter england", "arrow", "van heusen", "raymond", "park avenue"]
}

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

def _compute_luxury_score(brand, name=None) -> float:
    text_parts = [value for value in (brand, name) if isinstance(value, str)]
    if not text_parts:
        return 0.1
    name_lower = " ".join(text_parts).lower()
    for brand in LUXURY_BRANDS["high"]:
        if brand in name_lower:
            return 1.0
    for brand in LUXURY_BRANDS["mid"]:
        if brand in name_lower:
            return 0.6
    for brand in LUXURY_BRANDS["entry"]:
        if brand in name_lower:
            return 0.3
    return 0.1

# ── Load catalog ──────────────────────────────────────────────────────────────
print("Loading catalog ...")
catalog_df = pd.read_parquet(CATALOG_PATH)
catalog_df = catalog_df.reset_index(drop=True)
if "brand" not in catalog_df.columns:
    catalog_df["brand"] = catalog_df["productDisplayName"].apply(extract_brand)
HAS_CLIP = (
    ENABLE_CLIP
    and "clip_embedding" in catalog_df.columns
    and open_clip is not None
    and torch is not None
)
print(f"  {len(catalog_df):,} products")

catalog_df["luxury_score"] = catalog_df.apply(
    lambda row: _compute_luxury_score(
        row.get("brand"),
        row.get("productDisplayName"),
    ),
    axis=1,
)

# ── Build MiniLM FAISS index ──────────────────────────────────────────────────
print("Building MiniLM FAISS index ...")
minilm_matrix = np.vstack(catalog_df["text_embedding"].values).astype("float32")
faiss.normalize_L2(minilm_matrix)
minilm_index = faiss.IndexFlatIP(minilm_matrix.shape[1])
minilm_index.add(minilm_matrix)
print(f"  MiniLM index: {minilm_index.ntotal} vectors (dim={minilm_matrix.shape[1]})")

# ── Build CLIP FAISS index when available ─────────────────────────────────────
if HAS_CLIP:
    print("Building CLIP FAISS index ...")
    clip_matrix = np.vstack(catalog_df["clip_embedding"].values).astype("float32")
    faiss.normalize_L2(clip_matrix)
    clip_index = faiss.IndexFlatIP(clip_matrix.shape[1])
    clip_index.add(clip_matrix)
    print(f"  CLIP index: {clip_index.ntotal} vectors (dim={clip_matrix.shape[1]})")
else:
    clip_index = None
    if not ENABLE_CLIP:
        print("  CLIP disabled: set LUXE_ENABLE_CLIP=1 to enable CLIP query scoring")
    else:
        print("  CLIP disabled: run scripts/generate_clip_embeddings.py to add clip_embedding")

# ── Build BM25 index ──────────────────────────────────────────────────────────
print("Building BM25 index ...")
tokenized_corpus = [tokenize(doc) for doc in catalog_df["final_embedding_text"].tolist()]
bm25 = BM25Okapi(tokenized_corpus)
print(f"  BM25 index: {len(tokenized_corpus)} documents")

# ── Load MiniLM model ─────────────────────────────────────────────────────────
print("Loading MiniLM model ...")
minilm_model = SentenceTransformer("all-MiniLM-L6-v2")

# ── CLIP model (lazy-loaded on first search call) ─────────────────────────────
# Loading at module level causes an MPS init deadlock on Python 3.13 when
# search.py is imported by evaluation.py. Lazy loading avoids this entirely.
clip_model = None
clip_tokenizer = None
device = "cpu"
_clip_loaded = False


def _ensure_clip_loaded():
    global clip_model, clip_tokenizer, device, _clip_loaded
    if _clip_loaded:
        return
    _clip_loaded = True
    if not HAS_CLIP:
        return
    print("Loading CLIP model (lazy) ...", flush=True)
    _m, _, _ = _timed_clip_step(
        "open_clip.create_model_and_transforms",
        lambda: open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai"),
    )
    _timed_clip_step("model.eval", lambda: _m.eval())
    _d = "cpu"
    print(f"  CLIP device: {_d}", flush=True)
    _m2 = _timed_clip_step("model.to(device)", lambda: _m.to(_d))
    _tok = _timed_clip_step(
        "open_clip.get_tokenizer",
        lambda: open_clip.get_tokenizer("ViT-B-32"),
    )
    clip_model, clip_tokenizer, device = _m2, _tok, _d
    print("  CLIP ready.", flush=True)


print("\nSearch ready.\n")


# ── Helper: normalize array to [0, 1] ────────────────────────────────────────
def _norm(arr: np.ndarray) -> np.ndarray:
    mn, mx = arr.min(), arr.max()
    if mx - mn < 1e-9:
        return np.ones_like(arr)
    return (arr - mn) / (mx - mn)


def _filter_mask(filters: dict | None) -> np.ndarray:
    mask = np.ones(len(catalog_df), dtype=bool)
    if not filters:
        return mask
    for col, val in filters.items():
        if col in catalog_df.columns:
            mask &= catalog_df[col].values == val
    return mask


def _norm_on_mask(arr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    normalized = np.zeros_like(arr)
    values = arr[mask]
    if len(values) == 0:
        return normalized
    mn, mx = values.min(), values.max()
    if mx - mn < 1e-9:
        normalized[mask] = 1.0
    else:
        normalized[mask] = (values - mn) / (mx - mn)
    return normalized


# ── Core search function ──────────────────────────────────────────────────────
def search(query: str, top_k: int = 10, filters: dict = None) -> pd.DataFrame:
    """
    Hybrid search + cross-encoder reranking over the LuxeAgent catalog.

    Pipeline:
        1. Query expansion
        2. MiniLM semantic retrieval + BM25 + luxury scoring → top RERANK_FETCH
        3. Cross-encoder reranker → top_k final results

    Args:
        query:   Natural language query, e.g. "premium navy men's shirt"
        top_k:   Number of results to return after reranking
        filters: Optional dict, e.g. {"gender": "Men"} or {"articleType": "Shirts"}

    Returns:
        DataFrame sorted by rerank_score (descending)
    """
    _ensure_clip_loaded()
    candidate_mask = _filter_mask(filters)

    # Fetch more candidates than needed so the reranker has room to work
    fetch_k = len(catalog_df) if filters else min(RERANK_FETCH * 4, len(catalog_df))
    expanded_query = expand_query(query)

    # 1. Semantic score (MiniLM)
    query_vec = minilm_model.encode(
        expanded_query, normalize_embeddings=True
    ).astype("float32").reshape(1, -1)
    sem_scores_raw, sem_indices = minilm_index.search(query_vec, fetch_k)
    semantic_full = np.zeros(len(catalog_df), dtype="float32")
    semantic_full[sem_indices[0]] = sem_scores_raw[0]

    # 2. CLIP score
    if HAS_CLIP:
        with torch.no_grad():
            text_tokens = clip_tokenizer([expanded_query]).to(device)
            clip_text_vec = clip_model.encode_text(text_tokens)
            clip_text_vec = clip_text_vec / clip_text_vec.norm(dim=-1, keepdim=True)
        clip_query = clip_text_vec.cpu().numpy().astype("float32")
        clip_scores_raw, clip_indices = clip_index.search(clip_query, fetch_k)
        clip_full = np.zeros(len(catalog_df), dtype="float32")
        clip_full[clip_indices[0]] = clip_scores_raw[0]
    else:
        clip_full = None

    # 3. BM25 score
    bm25_scores = bm25.get_scores(tokenize(expanded_query)).astype("float32")

    # 4. Luxury score
    luxury_scores = catalog_df["luxury_score"].values.astype("float32")

    # 5. Normalize all to [0, 1]
    sem_norm    = _norm_on_mask(semantic_full, candidate_mask)
    clip_norm   = _norm_on_mask(clip_full, candidate_mask) if clip_full is not None else None
    bm25_norm   = _norm_on_mask(bm25_scores, candidate_mask)
    luxury_norm = _norm_on_mask(luxury_scores, candidate_mask)

    # 6. Hybrid final score
    final_scores = combine_scores(
        semantic=sem_norm,
        bm25=bm25_norm,
        clip=clip_norm,
        luxury=luxury_norm,
    )

    # 7. Build candidate pool (top RERANK_FETCH from hybrid)
    results = catalog_df.copy()
    results["semantic_score"] = sem_norm
    if clip_norm is not None:
        results["clip_score"] = clip_norm
    results["bm25_score"]     = bm25_norm
    results["expanded_query"] = expanded_query
    results["final_score"]    = final_scores
    results = results[candidate_mask]
    results = results.sort_values("final_score", ascending=False)
    candidates = results.head(RERANK_FETCH).reset_index(drop=True)

    # 8. Cross-encoder reranking — uses original query (not expanded)
    reranked = rerank(query, candidates, top_k=top_k)

    columns = [
        "id", "productDisplayName", "gender", "articleType",
        "baseColour", "usage", "brand",
        "rerank_score", "final_score",
        "semantic_score", "bm25_score", "luxury_score", "link",
    ]
    if "clip_score" in reranked.columns:
        columns.insert(columns.index("rerank_score") + 1, "clip_score")
    # Only keep columns that exist
    columns = [c for c in columns if c in reranked.columns]
    return reranked[columns]


# ── Quick test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    test_queries = [
        "premium navy men's shirt",
        "elegant black women's dress",
        "casual white t-shirt",
        "luxury leather handbag",
        "formal brown shoes for men",
        "slim fit blue jeans",
        "gold earrings for women",
        "black sunglasses",
    ]

    for query in test_queries:
        print(f"\n{'─' * 70}")
        print(f"Query: '{query}'")
        print(f"{'─' * 70}")
        results = search(query, top_k=5)
        for _, row in results.iterrows():
            print(
                f"  [rerank={row['rerank_score']:.3f} hybrid={row['final_score']:.3f}] "
                f"{row['productDisplayName']} "
                f"({row['articleType']}, {row['gender']}, {row['baseColour']})"
            )