import assert from "node:assert/strict";
import test from "node:test";

import { groupOutfit, isOutfitEmpty } from "./outfit-builder.ts";
import { OCCASION_RULES } from "./occasionFilter.ts";

/** Build a minimal RankedProduct-shaped object for tests. */
const make = (id, article_type, final_score, outfit_category) => ({
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
  outfit_category,
});

test("groupOutfit buckets products into outfit slots", () => {
  const outfit = groupOutfit([
    make(1, "Shirts", 0.9, "tops"),
    make(2, "Chinos", 0.8, "bottoms"),
    make(3, "Loafers", 0.7, "footwear"),
    make(4, "Watches", 0.6, "accessories"),
  ]);

  assert.deepEqual(outfit.tops.map((p) => p.id), [1]);
  assert.deepEqual(outfit.bottoms.map((p) => p.id), [2]);
  assert.deepEqual(outfit.footwear.map((p) => p.id), [3]);
  assert.deepEqual(outfit.accessories.map((p) => p.id), [4]);
});

test("groupOutfit drops the 'other' category", () => {
  const outfit = groupOutfit([
    make(1, "Shirts", 0.9, "tops"),
    make(2, "Fragrance", 0.8, "other"),
  ]);

  assert.deepEqual(outfit.tops.map((p) => p.id), [1]);
  assert.equal(
    outfit.bottoms.length + outfit.footwear.length + outfit.accessories.length,
    0,
  );
});

test("groupOutfit respects per-slot caps and preserves order", () => {
  const outfit = groupOutfit(
    [
      make(1, "Shirts", 0.95, "tops"),
      make(2, "Tshirts", 0.9, "tops"),
      make(3, "Blazers", 0.85, "tops"),
    ],
    { perSlotLimit: { tops: 2 } },
  );

  // Cap honored and the highest-relevance items (already ordered) are kept.
  assert.deepEqual(outfit.tops.map((p) => p.id), [1, 2]);
});

test("groupOutfit falls back to article-type classification", () => {
  // No outfit_category annotation -> classifyArticleType infers the slot.
  const outfit = groupOutfit([
    make(1, "Casual Shirt", 0.9, undefined),
    make(2, "Loafers", 0.8, undefined),
  ]);

  assert.deepEqual(outfit.tops.map((p) => p.id), [1]);
  assert.deepEqual(outfit.footwear.map((p) => p.id), [2]);
});

test("groupOutfit strips orchestrator bookkeeping from results", () => {
  const outfit = groupOutfit([
    { ...make(1, "Shirts", 0.9, "tops"), matched_term: "linen shirt", diversity_boost: 0.5 },
  ]);

  const [top] = outfit.tops;
  assert.equal(top.id, 1);
  assert.equal("matched_term" in top, false);
  assert.equal("outfit_category" in top, false);
  assert.equal("diversity_boost" in top, false);
});

/** Like `make`, but lets the test set usage_type (needed for occasion rules). */
const makeU = (id, article_type, usage_type, outfit_category) => ({
  ...make(id, article_type, 0.9, outfit_category),
  usage_type,
});

test("groupOutfit enforces per-slot occasion whitelists (footwear)", () => {
  const outfit = groupOutfit(
    [
      makeU(1, "Sports Shoes", "Formal", "footwear"), // not in WEDDING footwear
      makeU(2, "Loafers", "Formal", "footwear"), // allowed
    ],
    { occasionRule: OCCASION_RULES.WEDDING_FORMAL },
  );

  assert.deepEqual(outfit.footwear.map((p) => p.id), [2]);
});

test("groupOutfit falls back to unfiltered candidates when a slot is emptied", () => {
  // Only candidate for the footwear slot is disallowed by the occasion rule,
  // so the slot would be empty — Step 5 says fall back rather than drop it.
  const filtered = [makeU(1, "Sports Shoes", "Formal", "footwear")];
  const outfit = groupOutfit(filtered, {
    occasionRule: OCCASION_RULES.WEDDING_FORMAL,
    fallbackProducts: filtered,
  });

  assert.deepEqual(outfit.footwear.map((p) => p.id), [1]);
});

test("isOutfitEmpty detects empty vs populated outfits", () => {
  assert.equal(isOutfitEmpty({ tops: [], bottoms: [], footwear: [], accessories: [] }), true);
  assert.equal(
    isOutfitEmpty({ tops: [make(1, "Shirts", 0.9, "tops")], bottoms: [], footwear: [], accessories: [] }),
    false,
  );
});
