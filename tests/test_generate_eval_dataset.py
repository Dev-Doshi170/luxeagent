import csv
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from evaluation import load_judgments
from generate_eval_dataset import generate_evaluation_rows, write_evaluation_csv


class GenerateEvalDatasetTests(unittest.TestCase):
    def test_generates_metadata_queries_with_matching_relevant_ids(self):
        catalog = pd.DataFrame(
            [
                {
                    "id": 1,
                    "baseColour": "Black",
                    "articleType": "Watches",
                    "usage": "Casual",
                    "gender": "Men",
                    "season": "Fall",
                },
                {
                    "id": 2,
                    "baseColour": "Black",
                    "articleType": "Watches",
                    "usage": "Casual",
                    "gender": "Women",
                    "season": "Winter",
                },
                {
                    "id": 3,
                    "baseColour": "Blue",
                    "articleType": "Jeans",
                    "usage": "Casual",
                    "gender": "Men",
                    "season": "Summer",
                },
                {
                    "id": 4,
                    "baseColour": "White",
                    "articleType": "Handbags",
                    "usage": "Casual",
                    "gender": "Women",
                    "season": "Summer",
                },
                {
                    "id": 5,
                    "baseColour": "Green",
                    "articleType": "Shirts",
                    "usage": "Casual",
                    "gender": "Men",
                    "season": "Fall",
                },
                {
                    "id": 6,
                    "baseColour": "Brown",
                    "articleType": "Belts",
                    "usage": "Formal",
                    "gender": "Men",
                    "season": "Fall",
                },
            ]
        )

        rows = generate_evaluation_rows(catalog, query_count=5)

        self.assertEqual(
            rows,
            [
                {"query": "black watch", "relevant_ids": [1, 2]},
                {"query": "blue jeans", "relevant_ids": [3]},
                {"query": "casual shirt", "relevant_ids": [5]},
                {"query": "brown belt", "relevant_ids": [6]},
                {"query": "white handbag", "relevant_ids": [4]},
            ],
        )

    def test_writes_csv_compatible_with_evaluation_loader(self):
        rows = [{"query": "black watch", "relevant_ids": [1, 2]}]

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "evaluation_queries.csv"
            write_evaluation_csv(rows, output_path)

            with output_path.open(newline="", encoding="utf-8") as handle:
                csv_rows = list(csv.DictReader(handle))

            self.assertEqual(csv_rows, [{"query": "black watch", "relevant_ids": "1,2"}])
            self.assertEqual(
                load_judgments(output_path),
                [{"query": "black watch", "relevant_ids": {1, 2}}],
            )


if __name__ == "__main__":
    unittest.main()
