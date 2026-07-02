import assert from "node:assert/strict";
import test from "node:test";

import { computeBM25Score, getIDF } from "./bm25.ts";

test("getIDF computes non-negative scores for corpus terms", () => {
  const shirtIDF = getIDF("shirt");
  const randomIDF = getIDF("nonexistentterm12345");

  assert.ok(shirtIDF > 0, "Known term should have positive IDF");
  assert.ok(randomIDF > shirtIDF, "Rare terms should have higher IDF than common terms");
});

test("computeBM25Score ranks exact matches higher than partial ones", () => {
  const query = "navy shirt";
  const doc1 = "Gucci premium navy shirt for men";
  const doc2 = "Gucci premium blue shirt for men";
  const doc3 = "Zara formal green shirt";

  const score1 = computeBM25Score(doc1, query);
  const score2 = computeBM25Score(doc2, query);
  const score3 = computeBM25Score(doc3, query);

  assert.ok(score1 > score2, "Exact match of navy and shirt should rank higher than shirt only");
  assert.ok(score2 > 0, "Shirt match should score positive");
  assert.ok(score3 > 0, "Green shirt should score positive");
  assert.ok(score3 > score2, "Shorter document with match should rank higher than longer document under BM25 length normalization");
});

test("computeBM25Score returns 0 for completely unrelated documents", () => {
  const query = "navy shirt";
  const doc = "Zara brown leather belt for women";
  const score = computeBM25Score(doc, query);
  assert.equal(score, 0);
});
