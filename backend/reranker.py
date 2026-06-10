"""
reranker.py
===========
Cross-encoder reranker for LuxeAgent.

Takes the top-N candidates from the hybrid retrieval pipeline and
re-scores each one by reading the query and product description
*together* — giving much more accurate relevance judgements.

Model: cross-encoder/ms-marco-MiniLM-L-6-v2
  - Fast, lightweight
  - Works on CPU (no GPU needed)
  - Already compatible with sentence-transformers 5.x
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sentence_transformers import CrossEncoder

# Loaded once at import time — small model, ~80 MB
_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_reranker: CrossEncoder | None = None


def _get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        print(f"Loading cross-encoder reranker ({_MODEL_NAME}) ...", flush=True)
        _reranker = CrossEncoder(_MODEL_NAME, max_length=512)
        print("  Reranker ready.", flush=True)
    return _reranker


def rerank(query: str, candidates: pd.DataFrame, top_k: int = 10) -> pd.DataFrame:
    """
    Rerank candidate results using the cross-encoder.

    Args:
        query:      The original user query (unexpanded)
        candidates: DataFrame from the hybrid search (top 50 or so)
        top_k:      How many to return after reranking

    Returns:
        DataFrame with added `rerank_score` column, sorted best-first,
        trimmed to top_k rows.
    """
    if candidates.empty:
        return candidates

    reranker = _get_reranker()

    # Build (query, product_text) pairs for the cross-encoder
    # We use productDisplayName + articleType + baseColour for richer context
    pairs = []
    for _, row in candidates.iterrows():
        product_text = _build_product_text(row)
        pairs.append((query, product_text))

    # Score all pairs — returns a numpy array of floats
    scores = reranker.predict(pairs, show_progress_bar=False)

    result = candidates.copy()
    result["rerank_score"] = scores.astype("float32")
    result = result.sort_values("rerank_score", ascending=False)
    result = result.head(top_k).reset_index(drop=True)
    return result


def _build_product_text(row: pd.Series) -> str:
    """Build a short but rich product description for the cross-encoder."""
    parts = []

    name = row.get("productDisplayName", "")
    if name:
        parts.append(str(name))

    article = row.get("articleType", "")
    colour = row.get("baseColour", "")
    gender = row.get("gender", "")
    usage = row.get("usage", "")
    brand = row.get("brand", "")

    details = " | ".join(
        v for v in [article, colour, gender, usage, brand] if v and str(v) != "nan"
    )
    if details:
        parts.append(details)

    return ". ".join(parts)