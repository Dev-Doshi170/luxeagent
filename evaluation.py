"""
Offline retrieval evaluation for LuxeAgent.

Expected CSV format:
    query,relevant_ids
    navy shirt,"15970,30805"

The CLI imports the search backend only when executed, so metric helpers remain
fast and testable without loading FAISS or embedding models.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Iterable


def parse_relevant_ids(value: str) -> set[int]:
    """Parse comma- or whitespace-separated relevant product IDs."""
    if not value:
        return set()
    return {int(token) for token in re.findall(r"\d+", value)}


def load_judgments(csv_path: Path) -> list[dict[str, object]]:
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = {"query", "relevant_ids"} - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing required CSV columns: {', '.join(sorted(missing))}")

        judgments = []
        for row in reader:
            query = (row.get("query") or "").strip()
            relevant_ids = parse_relevant_ids(row.get("relevant_ids") or "")
            if query and relevant_ids:
                judgments.append({"query": query, "relevant_ids": relevant_ids})
        return judgments


def _recall_at(ranked_ids: list[int], relevant_ids: set[int], k: int) -> float:
    if not relevant_ids:
        return 0.0
    return len(set(ranked_ids[:k]) & relevant_ids) / len(relevant_ids)


def _reciprocal_rank(ranked_ids: list[int], relevant_ids: set[int]) -> float:
    for index, product_id in enumerate(ranked_ids, start=1):
        if product_id in relevant_ids:
            return 1.0 / index
    return 0.0


def calculate_metrics(
    judgments: Iterable[dict[str, object]],
    results_by_query: dict[str, list[int]],
) -> dict[str, float]:
    rows = list(judgments)
    if not rows:
        return {"num_queries": 0, "recall@10": 0.0, "recall@20": 0.0, "mrr": 0.0}

    recall_10 = []
    recall_20 = []
    reciprocal_ranks = []

    for row in rows:
        query = str(row["query"])
        relevant_ids = set(row["relevant_ids"])
        ranked_ids = results_by_query.get(query, [])
        recall_10.append(_recall_at(ranked_ids, relevant_ids, 10))
        recall_20.append(_recall_at(ranked_ids, relevant_ids, 20))
        reciprocal_ranks.append(_reciprocal_rank(ranked_ids, relevant_ids))

    count = len(rows)
    return {
        "num_queries": count,
        "recall@10": sum(recall_10) / count,
        "recall@20": sum(recall_20) / count,
        "mrr": sum(reciprocal_ranks) / count,
    }


def run_searches(judgments: list[dict[str, object]], top_k: int) -> dict[str, list[int]]:
    repo_root = Path(__file__).parent
    sys.path.append(str(repo_root / "backend"))
    from search import search

    results_by_query = {}
    for row in judgments:
        query = str(row["query"])
        results_df = search(query, top_k=top_k)
        results_by_query[query] = [int(product_id) for product_id in results_df["id"].tolist()]
    return results_by_query


def format_metrics_table(metrics: dict[str, float]) -> str:
    rows = [
        ("Queries", f"{int(metrics['num_queries'])}"),
        ("Recall@10", f"{metrics['recall@10']:.4f}"),
        ("Recall@20", f"{metrics['recall@20']:.4f}"),
        ("MRR", f"{metrics['mrr']:.4f}"),
    ]
    name_width = max(len(name) for name, _ in rows)
    value_width = max(len(value) for _, value in rows)
    border = f"+-{'-' * name_width}-+-{'-' * value_width}-+"
    lines = [border]
    for name, value in rows:
        lines.append(f"| {name.ljust(name_width)} | {value.rjust(value_width)} |")
    lines.append(border)
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate LuxeAgent retrieval quality.")
    parser.add_argument("judgments_csv", type=Path, help="CSV with query,relevant_ids columns")
    parser.add_argument("--top-k", type=int, default=20, help="Search depth to retrieve")
    args = parser.parse_args()

    judgments = load_judgments(args.judgments_csv)
    results_by_query = run_searches(judgments, top_k=max(args.top_k, 20))
    metrics = calculate_metrics(judgments, results_by_query)
    print(format_metrics_table(metrics))


if __name__ == "__main__":
    main()
