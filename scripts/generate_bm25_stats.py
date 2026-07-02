import os
import json
import pandas as pd
from pathlib import Path

# Add backend directory to path to import tokenize
import sys
sys.path.append(str(Path(__file__).parent.parent / "backend"))
from query_expansion import tokenize

def main():
    # Load catalog
    CATALOG_PATH = Path(__file__).parent.parent / "data" / "balanced_catalog_with_embeddings.parquet"
    if not CATALOG_PATH.exists():
        print(f"Catalog file not found at {CATALOG_PATH}")
        sys.exit(1)
        
    df = pd.read_parquet(CATALOG_PATH)
    
    # Use final_embedding_text
    texts = df["final_embedding_text"].tolist()
    corpus = [tokenize(str(text)) for text in texts]
    
    N = len(corpus)
    doc_lengths = [len(doc) for doc in corpus]
    avgdl = sum(doc_lengths) / N
    
    doc_freqs = {}
    for doc in corpus:
        seen_in_doc = set(doc)
        for term in seen_in_doc:
            doc_freqs[term] = doc_freqs.get(term, 0) + 1
            
    stats = {
        "N": N,
        "avgdl": avgdl,
        "doc_freqs": doc_freqs
    }
    
    output_path = Path(__file__).parent.parent / "frontend" / "src" / "lib" / "bm25_stats.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)
        
    print(f"Successfully generated BM25 stats:")
    print(f"  Total documents (N): {N}")
    print(f"  Average document length (avgdl): {avgdl:.4f}")
    print(f"  Unique terms: {len(doc_freqs)}")
    print(f"  Saved stats to: {output_path}")

if __name__ == "__main__":
    main()
