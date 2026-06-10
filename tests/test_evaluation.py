import unittest

from evaluation import calculate_metrics, parse_relevant_ids


class EvaluationTests(unittest.TestCase):
    def test_parse_relevant_ids_accepts_commas_and_spaces(self):
        self.assertEqual(parse_relevant_ids("15970, 39386 59263"), {15970, 39386, 59263})

    def test_calculate_metrics_reports_recall_and_mrr(self):
        judgments = [
            {"query": "navy shirt", "relevant_ids": {15970, 30805}},
            {"query": "silver watch", "relevant_ids": {59263}},
        ]
        results = {
            "navy shirt": [111, 15970, 222, 30805],
            "silver watch": [333, 444, 59263],
        }

        metrics = calculate_metrics(judgments, results)

        self.assertEqual(metrics["num_queries"], 2)
        self.assertEqual(metrics["recall@10"], 1.0)
        self.assertEqual(metrics["recall@20"], 1.0)
        self.assertAlmostEqual(metrics["mrr"], (1 / 2 + 1 / 3) / 2)


if __name__ == "__main__":
    unittest.main()
