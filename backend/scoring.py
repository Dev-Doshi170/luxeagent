"""Shared scoring weights for LuxeAgent retrieval."""

from __future__ import annotations

import numpy as np


TEXT_WEIGHTS = {
    "semantic": 0.60,
    "bm25": 0.25,
    "luxury": 0.15,
}

MULTIMODAL_WEIGHTS = {
    "semantic": 0.50,
    "bm25": 0.20,
    "clip": 0.20,
    "luxury": 0.10,
}


def combine_scores(
    *,
    semantic: np.ndarray,
    bm25: np.ndarray,
    luxury: np.ndarray,
    clip: np.ndarray | None = None,
) -> np.ndarray:
    """Combine normalized retrieval scores with text or multimodal weights."""
    if clip is None:
        return (
            TEXT_WEIGHTS["semantic"] * semantic
            + TEXT_WEIGHTS["bm25"] * bm25
            + TEXT_WEIGHTS["luxury"] * luxury
        )

    return (
        MULTIMODAL_WEIGHTS["semantic"] * semantic
        + MULTIMODAL_WEIGHTS["bm25"] * bm25
        + MULTIMODAL_WEIGHTS["clip"] * clip
        + MULTIMODAL_WEIGHTS["luxury"] * luxury
    )
