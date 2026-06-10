import unittest

import numpy as np

from backend.scoring import combine_scores


class ScoringTests(unittest.TestCase):
    def test_combine_scores_uses_text_weights_without_clip(self):
        scores = combine_scores(
            semantic=np.array([1.0]),
            bm25=np.array([0.5]),
            luxury=np.array([0.2]),
        )

        self.assertAlmostEqual(scores[0], 0.60 * 1.0 + 0.25 * 0.5 + 0.15 * 0.2)

    def test_combine_scores_uses_multimodal_weights_with_clip(self):
        scores = combine_scores(
            semantic=np.array([1.0]),
            bm25=np.array([0.5]),
            luxury=np.array([0.2]),
            clip=np.array([0.4]),
        )

        self.assertAlmostEqual(
            scores[0],
            0.50 * 1.0 + 0.20 * 0.5 + 0.20 * 0.4 + 0.10 * 0.2,
        )


if __name__ == "__main__":
    unittest.main()
