import assert from "node:assert/strict";
import test from "node:test";

import {
  parseQuery,
  extractBudget,
  mergeIntents,
  parseWithLLMCached,
  parseWithLLM,
  isGeminiCircuitOpen,
  resetGeminiCircuit,
  GeminiCircuitOpenError,
} from "./query-parser.ts";
import { expandIntent, describeOntologyMatch } from "./query-expander.ts";
import { FASHION_ONTOLOGY } from "./fashion-ontology.ts";
import {
  orchestrateRetrieval,
  classifyArticleType,
} from "./retrieval-orchestrator.ts";

test("parseQuery extracts a full styling intent", () => {
  const intent = parseQuery(
    "Luxury summer outfit for a beach wedding in Goa under ₹25,000",
  );

  assert.equal(intent.style, "luxury");
  assert.equal(intent.season, "summer");
  assert.equal(intent.occasion, "beach wedding");
  assert.equal(intent.budget, 25000);
  assert.ok(intent.confidence >= 0.5);
});

test("parseQuery prefers the most specific occasion", () => {
  const intent = parseQuery("a nice beach wedding look");
  assert.equal(intent.occasion, "beach wedding");
});

test("extractBudget handles common phrasings", () => {
  assert.equal(extractBudget("below 10000"), 10000);
  assert.equal(extractBudget("budget 5000"), 5000);
  assert.equal(extractBudget("under 1.5k"), 1500);
  assert.equal(extractBudget("a casual shirt"), undefined);
});

test("expandIntent maps occasion+style via the ontology", () => {
  const terms = expandIntent(
    { occasion: "beach wedding", style: "luxury" },
    { applySeasonModifiers: false },
  );
  assert.deepEqual(terms, [
    "linen shirt",
    "beige chinos",
    "summer blazer",
    "loafers",
  ]);
});

test("expandIntent falls back to default when style is missing", () => {
  const terms = expandIntent(
    { occasion: "office" },
    { applySeasonModifiers: false },
  );
  assert.deepEqual(terms, ["formal shirt", "formal trousers", "formal shoes"]);
});

test("classifyArticleType buckets article types", () => {
  assert.equal(classifyArticleType("Casual Shirt"), "tops");
  assert.equal(classifyArticleType("Chinos"), "bottoms");
  assert.equal(classifyArticleType("Loafers"), "footwear");
  assert.equal(classifyArticleType("Watches"), "accessories");
});

test("orchestrateRetrieval merges, dedupes, and diversifies", async () => {
  const make = (id, article_type, final_score) => ({
    id,
    name: `p${id}`,
    brand: null,
    gender: "Men",
    article_type,
    colour: "blue",
    usage_type: "Casual",
    image_url: "",
    semantic_score: final_score,
    keyword_score: final_score,
    final_score,
  });

  // Stub search: returns many shirts but few of other categories, plus a dup.
  const searchFn = async (term) => {
    if (term === "linen shirt") {
      return [make(1, "Shirts", 0.9), make(2, "Shirts", 0.8)];
    }
    if (term === "beige chinos") {
      return [make(3, "Chinos", 0.7), make(1, "Shirts", 0.95)];
    }
    if (term === "loafers") {
      return [make(4, "Loafers", 0.6)];
    }
    return [];
  };

  const result = await orchestrateRetrieval({
    searchTerms: ["linen shirt", "beige chinos", "loafers"],
    searchFn,
    topK: 10,
    logger: { debug() {}, warn() {} },
  });

  const ids = result.products.map((p) => p.id);
  // Duplicate id 1 collapsed to a single entry.
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(result.mergedCount, 4);

  // All outfit categories are represented in the final set (no "12 shirts").
  const categories = new Set(result.products.map((p) => p.outfit_category));
  assert.ok(categories.has("tops"));
  assert.ok(categories.has("bottoms"));
  assert.ok(categories.has("footwear"));

  // Diversification works: the lower-relevance chinos (id 3) is ranked ABOVE
  // the second shirt (id 2) thanks to the diversity boost, even though id 2 has
  // a higher raw search score.
  const rankOf = (id) => result.products.findIndex((p) => p.id === id);
  assert.ok(rankOf(3) < rankOf(2));
});

test("mergeIntents prefers override scalars and unions arrays", () => {
  const merged = mergeIntents(
    { occasion: "office", colors: ["black"], confidence: 0.14 },
    { occasion: "party", style: "luxury", colors: ["red"] },
  );
  assert.equal(merged.occasion, "party");
  assert.equal(merged.style, "luxury");
  assert.deepEqual(new Set(merged.colors), new Set(["black", "red"]));
  // Confidence is recomputed from the merged result.
  assert.ok(merged.confidence > 0.14);
});

test("parseWithLLMCached caches failures (no key) without re-calling", async () => {
  // No GEMINI_API_KEY in the test env -> parseWithLLM throws immediately.
  delete process.env.GEMINI_API_KEY;
  const query = "totally-unique-test-query-xyz";

  await assert.rejects(() => parseWithLLMCached(query));
  // Second call should hit the negative cache and still reject (fast).
  await assert.rejects(() => parseWithLLMCached(query));
});

test("orchestrateRetrieval returns empty for no terms", async () => {
  const result = await orchestrateRetrieval({
    searchTerms: [],
    searchFn: async () => [],
    logger: { debug() {}, warn() {} },
  });
  assert.deepEqual(result.products, []);
});

test("season aliases collapse onto canonical seasons", () => {
  assert.equal(parseQuery("an outfit for the rainy season").season, "monsoon");
  assert.equal(parseQuery("something light for rain").season, "monsoon");
  assert.equal(parseQuery("looking for the rains").season, "monsoon");
  assert.equal(parseQuery("hot weather clothing").season, "summer");
});

test("word-boundary matching avoids false-positive parses", () => {
  // "rain" must not match inside "training".
  assert.equal(parseQuery("training shoes").season, undefined);
  // "men" must not match inside "women".
  assert.equal(parseQuery("a women's evening dress").gender, "women");
});

test("expandIntent never returns empty when given the original query", () => {
  // Bare intent with no signal still yields a usable term list.
  const terms = expandIntent({}, { originalQuery: "vintage leather jacket" });
  assert.ok(terms.length >= 1);
  assert.ok(terms.includes("vintage leather jacket"));
});

test("expandIntent always covers the original query (superset of legacy)", () => {
  const terms = expandIntent(
    { occasion: "beach wedding", style: "luxury" },
    { applySeasonModifiers: false, originalQuery: "raw user query" },
  );
  // Ontology terms still lead the list...
  assert.equal(terms[0], "linen shirt");
  // ...and the raw query is guaranteed to be present.
  assert.ok(terms.includes("raw user query"));
});

test("fashion ontology covers at least 15 occasions", () => {
  assert.ok(
    Object.keys(FASHION_ONTOLOGY).length >= 15,
    `expected >= 15 occasions, got ${Object.keys(FASHION_ONTOLOGY).length}`,
  );
});

test("describeOntologyMatch reports the matched bucket", () => {
  assert.match(
    describeOntologyMatch({ occasion: "beach wedding", style: "luxury" }),
    /beach wedding\/luxury/,
  );
  assert.match(describeOntologyMatch({}), /none/);
});

test("Gemini circuit breaker opens after a 429 and then skips calls", async () => {
  resetGeminiCircuit();
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";

  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return { ok: false, status: 429, text: async () => "rate limited" };
  };

  try {
    // First call hits the (mocked) 429 and trips the breaker.
    await assert.rejects(() => parseWithLLM("trigger a rate limit"));
    assert.equal(isGeminiCircuitOpen(), true);
    assert.equal(fetchCalls, 1);

    // Subsequent call short-circuits without touching the network.
    await assert.rejects(
      () => parseWithLLM("another query while open"),
      GeminiCircuitOpenError,
    );
    assert.equal(fetchCalls, 1);
  } finally {
    resetGeminiCircuit();
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
