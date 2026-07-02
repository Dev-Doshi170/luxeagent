import { tokenize } from "./queryExpansion.ts";
import bm25Stats from "./bm25_stats.json" with { type: "json" };

const k1 = 1.5;
const b = 0.75;

interface BM25Stats {
  N: number;
  avgdl: number;
  doc_freqs: Record<string, number>;
}

const stats = bm25Stats as BM25Stats;

/**
 * Calculate the inverse document frequency (IDF) for a term using the rank_bm25 formula:
 * IDF = ln((N - n(q) + 0.5) / (n(q) + 0.5) + 1)
 */
export function getIDF(term: string): number {
  const n_q = stats.doc_freqs[term] ?? 0;
  // ln((N - n_q + 0.5) / (n_q + 0.5) + 1)
  return Math.log((stats.N - n_q + 0.5) / (n_q + 0.5) + 1);
}

/**
 * Calculate the BM25 score of a document text for a given query text.
 */
export function computeBM25Score(docText: string, queryText: string): number {
  const docTokens = tokenize(docText);
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return 0;

  // Calculate term frequencies in doc
  const tfMap: Record<string, number> = {};
  for (const token of docTokens) {
    tfMap[token] = (tfMap[token] ?? 0) + 1;
  }

  const docLength = docTokens.length;
  let score = 0;

  for (const qTerm of queryTokens) {
    const tf = tfMap[qTerm] ?? 0;
    if (tf === 0) continue;

    const idf = getIDF(qTerm);
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + (b * docLength) / stats.avgdl);
    score += idf * (numerator / denominator);
  }

  return score;
}
