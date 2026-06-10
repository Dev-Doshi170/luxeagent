import assert from "node:assert/strict";
import test from "node:test";

import {
  matchOccasion,
  applyOccasionFilter,
  OCCASION_RULES,
} from "./occasionFilter.ts";

/** Build a minimal RankedProduct-shaped object for tests. */
const make = (id, article_type, usage_type, outfit_category) => ({
  id,
  name: `p${id}`,
  brand: null,
  gender: "Women",
  article_type,
  colour: "blue",
  usage_type,
  image_url: "",
  semantic_score: 1,
  keyword_score: 1,
  final_score: 1,
  outfit_category,
});

test("matchOccasion matches a single occasion (case-insensitive, partial)", () => {
  const rule = matchOccasion("Corporate MEETING");
  assert.ok(rule);
  assert.deepEqual(rule, OCCASION_RULES.OFFICE_WORK);
});

test("matchOccasion returns null for empty/unknown occasions", () => {
  assert.equal(matchOccasion(undefined), null);
  assert.equal(matchOccasion(""), null);
  assert.equal(matchOccasion("underwater basket weaving"), null);
});

test("matchOccasion merges multiple matches with the stricter rule winning", () => {
  // "beach wedding" hits both WEDDING (primary) and BEACH.
  const rule = matchOccasion("beach wedding");
  assert.ok(rule);

  // Blocked lists are unioned: WEDDING blocks Tshirts, BEACH blocks Blazers.
  const blocked = rule.blocked_article_types.map((s) => s.toLowerCase());
  assert.ok(blocked.includes("tshirts"));
  assert.ok(blocked.includes("blazers"));

  // allowed_footwear is the intersection of the two whitelists.
  const footwear = rule.allowed_footwear.map((s) => s.toLowerCase());
  assert.deepEqual(footwear.sort(), ["flats", "sandals"]);
});

test("applyOccasionFilter (slot=null) drops globally-blocked article types", () => {
  const rule = OCCASION_RULES.WEDDING_FORMAL;
  const products = [
    make(1, "Tshirts", "Casual", "tops"), // blocked article type
    make(2, "Shirts", "Formal", "tops"), // ok
    make(3, "Blazers", "Party", "tops"), // ok
  ];
  const out = applyOccasionFilter(products, rule, null);
  assert.deepEqual(out.map((p) => p.id), [2, 3]);
});

test("applyOccasionFilter does not filter on usage_type beyond blocked lists", () => {
  const rule = OCCASION_RULES.WEDDING_FORMAL;
  const products = [
    make(1, "Shirts", "Casual", "tops"), // Casual no longer disqualifies
    make(2, "Shirts", "Formal", "tops"), // ok
  ];
  const out = applyOccasionFilter(products, rule, null);
  assert.deepEqual(out.map((p) => p.id), [1, 2]);
});

test("applyOccasionFilter enforces allowed_footwear only for the footwear slot", () => {
  const rule = OCCASION_RULES.WEDDING_FORMAL; // no Sports Shoes in footwear
  const sportsShoe = make(1, "Sports Shoes", "Sports", "footwear");
  const heels = make(2, "Heels", "Formal", "footwear");

  // As footwear: Sports Shoes is not whitelisted -> removed.
  const footwear = applyOccasionFilter([sportsShoe, heels], rule, "footwear");
  assert.deepEqual(footwear.map((p) => p.id), [2]);
});

test("applyOccasionFilter enforces allowed_tops only for the tops slot", () => {
  const rule = OCCASION_RULES.OFFICE_WORK;
  const products = [
    make(1, "Tops", "Casual", "tops"), // allowed top
    make(2, "Dresses", "Casual", "tops"), // not in OFFICE allowed_tops
  ];
  const out = applyOccasionFilter(products, rule, "tops");
  assert.deepEqual(out.map((p) => p.id), [1]);
});

test("applyOccasionFilter is case-insensitive across all comparisons", () => {
  const rule = OCCASION_RULES.SPORTS_GYM; // requires Sports, footwear Sports Shoes
  const products = [
    make(1, "sports shoes", "sports", "footwear"),
    make(2, "HEELS", "Formal", "footwear"), // blocked article type "Heels"
  ];
  const out = applyOccasionFilter(products, rule, "footwear");
  assert.deepEqual(out.map((p) => p.id), [1]);
});
