import importlib
import os
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd


class SearchClipLoadingTests(unittest.TestCase):
    def tearDown(self):
        sys.modules.pop("backend.search", None)

    def test_import_does_not_eagerly_create_clip_model_by_default(self):
        class FakeFaiss(types.SimpleNamespace):
            def normalize_L2(self, matrix):
                return None

            class IndexFlatIP:
                def __init__(self, dim):
                    self.dim = dim
                    self.ntotal = 0

                def add(self, matrix):
                    self.ntotal = len(matrix)

                def search(self, query_vec, fetch_k):
                    return np.zeros((1, 1), dtype="float32"), np.zeros((1, 1), dtype=int)

        class FakeSentenceTransformer:
            def __init__(self, model_name):
                self.model_name = model_name

            def encode(self, *args, **kwargs):
                return np.array([1.0], dtype="float32")

        class FakeBM25:
            def __init__(self, corpus):
                self.corpus = corpus

            def get_scores(self, tokens):
                return np.ones(1, dtype="float32")

        def fail_if_clip_model_is_created(*args, **kwargs):
            raise AssertionError("CLIP model should not be created during default import")

        fake_catalog = pd.DataFrame(
            {
                "id": [1],
                "productDisplayName": ["Test Product"],
                "brand": ["Test"],
                "text_embedding": [np.array([1.0], dtype="float32")],
                "clip_embedding": [np.array([1.0], dtype="float32")],
                "final_embedding_text": ["test product"],
            }
        )

        fake_modules = {
            "faiss": FakeFaiss(),
            "sentence_transformers": types.SimpleNamespace(
                SentenceTransformer=FakeSentenceTransformer
            ),
            "rank_bm25": types.SimpleNamespace(BM25Okapi=FakeBM25),
            "open_clip": types.SimpleNamespace(
                create_model_and_transforms=fail_if_clip_model_is_created,
                get_tokenizer=lambda *args, **kwargs: None,
            ),
            "torch": types.SimpleNamespace(
                backends=types.SimpleNamespace(
                    mps=types.SimpleNamespace(is_available=lambda: True)
                )
            ),
        }

        with patch.dict(os.environ, {"LUXE_ENABLE_CLIP": ""}, clear=False):
            with patch.dict(sys.modules, fake_modules):
                with patch("pandas.read_parquet", return_value=fake_catalog):
                    sys.modules.pop("backend.search", None)
                    search_module = importlib.import_module("backend.search")

        self.assertFalse(search_module.HAS_CLIP)
        self.assertIsNone(search_module.clip_model)
        self.assertIsNone(search_module.clip_tokenizer)


if __name__ == "__main__":
    unittest.main()
