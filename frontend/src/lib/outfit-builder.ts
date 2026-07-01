/**
 * Outfit Builder
 * --------------
 * Turns a ranked, diversified list of products (the output of the
 * {@link import("./retrieval-orchestrator").orchestrateRetrieval} pipeline)
 * into a complete {@link Outfit} grouped by category:
 *
 *   [shirt, chinos, loafers, watch, sunglasses, ...]
 *     ->
 *   { tops: [shirt], bottoms: [chinos], footwear: [loafers],
 *     accessories: [watch, sunglasses] }
 *
 * It reuses the orchestrator's `outfit_category` classification (falling back to
 * {@link classifyArticleType} when a product was not annotated), preserves the
 * incoming relevance order within each slot, caps the number of items per slot
 * so the outfit stays focused, and drops the "other" bucket entirely.
 */

import type { Product } from "../types/product.ts";
import { mapIntentGender } from "./hybrid-search.ts";
import {
  classifyArticleType,
  type RankedProduct,
} from "./retrieval-orchestrator.ts";
import {
  EMPTY_OUTFIT,
  type Outfit,
  type OutfitSlot,
} from "../types/outfit.ts";
import type { QueryIntent } from "./query-parser.ts";
import {
  applyOccasionFilter,
  matchOccasion,
  OCCASION_CONFIDENCE_THRESHOLD,
  type OccasionRule,
} from "./occasionFilter.ts";

/**
 * Default cap on how many products to surface per outfit slot.
 * A curated luxury outfit shows one hero item per slot (plus a couple of
 * complementary accessories), not three interchangeable alternatives.
 */
export const DEFAULT_PER_SLOT_LIMIT: Record<OutfitSlot, number> = {
  tops: 1,
  bottoms: 1,
  footwear: 1,
  accessories: 2,
};

export interface GroupOutfitOptions {
  /** Per-slot caps; merged over {@link DEFAULT_PER_SLOT_LIMIT}. */
  perSlotLimit?: Partial<Record<OutfitSlot, number>>;
  /**
   * Active occasion rule (already confidence-gated by {@link refineCandidates}).
   * When present, each slot's candidates are passed through
   * {@link applyOccasionFilter} with the specific slot so per-slot whitelists
   * (allowed_footwear / allowed_tops) are enforced.
   */
  occasionRule?: OccasionRule | null;
  /**
   * The gender-filtered candidates *before* any occasion filtering. Used as the
   * per-slot safety net: if the occasion filter empties a slot, that slot falls
   * back to these (occasion-unfiltered) candidates so the outfit is never
   * empty just because the filter was too strict (see Step 5).
   */
  fallbackProducts?: RankedProduct[];
}

/** The four UI-facing outfit slots (excludes the orchestrator's "other"). */
const SLOTS: readonly OutfitSlot[] = ["tops", "bottoms", "footwear", "accessories"];

const slotOf = (product: RankedProduct): OutfitSlot | "other" =>
  product.outfit_category ?? classifyArticleType(product.article_type);

/** Bucket products into their outfit slot, preserving incoming relevance order. */
function bucketBySlot(
  products: RankedProduct[],
): Record<OutfitSlot, RankedProduct[]> {
  const buckets: Record<OutfitSlot, RankedProduct[]> = {
    tops: [],
    bottoms: [],
    footwear: [],
    accessories: [],
  };
  for (const product of products) {
    const slot = slotOf(product);
    if (slot === "other") continue;
    buckets[slot].push(product);
  }
  return buckets;
}

/** Strip orchestrator bookkeeping so the UI receives clean Product objects. */
function toCleanProduct(product: RankedProduct): Product {
  const { matched_term, outfit_category, diversity_boost, ...clean } = product;
  void matched_term;
  void outfit_category;
  void diversity_boost;
  return clean as Product;
}

/**
 * Group ranked products into a complete outfit composition.
 *
 * Products are expected to already be sorted by relevance (as the orchestrator
 * returns them); this function preserves that order within each slot. Items in
 * the "other" category are excluded from the outfit.
 *
 * When an {@link GroupOutfitOptions.occasionRule} is supplied, each slot's
 * candidates are additionally filtered through {@link applyOccasionFilter} for
 * that slot. If filtering empties a slot, it falls back to the
 * {@link GroupOutfitOptions.fallbackProducts} (occasion-unfiltered) candidates
 * for that slot so we never drop a slot purely because the filter was strict.
 */
export function groupOutfit(
  products: RankedProduct[],
  options: GroupOutfitOptions = {},
): Outfit {
  const limits = { ...DEFAULT_PER_SLOT_LIMIT, ...options.perSlotLimit };
  const { occasionRule, fallbackProducts } = options;

  const buckets = bucketBySlot(products);
  const fallbackBuckets = fallbackProducts
    ? bucketBySlot(fallbackProducts)
    : null;

  // Start from a fresh outfit so callers never share array references.
  const outfit: Outfit = {
    tops: [],
    bottoms: [],
    footwear: [],
    accessories: [],
  };

  for (const slot of SLOTS) {
    let candidates = buckets[slot];

    if (occasionRule) {
      const filtered = applyOccasionFilter(candidates, occasionRule, slot);
      if (filtered.length === 0) {
        // Step 5 — never let the occasion filter zero out a slot. Skip the
        // filter for this slot only and fall back to the unfiltered candidates.
        const fallback = fallbackBuckets ? fallbackBuckets[slot] : candidates;
        if (fallback.length > 0) {
          console.warn(
            `[OccasionFilter] slot ${slot} had 0 results after filtering, falling back to unfiltered`,
          );
          candidates = fallback;
        }
      } else {
        candidates = filtered;
      }
    }

    outfit[slot] = candidates.slice(0, limits[slot]).map(toCleanProduct);
  }

  return outfit;
}

/** True when an outfit has at least one product in any slot. */
export function isOutfitEmpty(outfit: Outfit): boolean {
  return SLOTS.every((slot) => outfit[slot].length === 0);
}

/** How many of the top-scored products to inspect when inferring gender. */
const GENDER_INFERENCE_SAMPLE = 5;
/** Minimum number of agreeing products needed to declare a dominant gender. */
const GENDER_MAJORITY_THRESHOLD = 3;

/**
 * Article types allowed in the footwear slot for any gender (case-insensitive).
 */
const FOOTWEAR_ALLOWED_BASE: readonly string[] = [
  "shoes",
  "sandals",
  "loafers",
  "casual shoes",
  "sports shoes",
];
/** Additional footwear article types only valid for women. */
const FOOTWEAR_ALLOWED_WOMEN_EXTRA: readonly string[] = ["flats", "heels"];

/**
 * Infer the dominant gender from the highest-scoring products.
 *
 * Looks at the top {@link GENDER_INFERENCE_SAMPLE} products by `final_score`
 * and returns the gender shared by at least {@link GENDER_MAJORITY_THRESHOLD}
 * of them ("Men" or "Women"). Returns null when there is no clear majority, so
 * callers can keep the full (mixed-gender) candidate list.
 */
export function inferDominantGender(
  products: RankedProduct[],
): string | null {
  const top = [...products]
    .sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0))
    .slice(0, GENDER_INFERENCE_SAMPLE);

  const counts = new Map<string, number>();
  for (const product of top) {
    const gender = product.gender;
    if (gender !== "Men" && gender !== "Women") continue;
    counts.set(gender, (counts.get(gender) ?? 0) + 1);
  }

  for (const [gender, count] of counts) {
    if (count >= GENDER_MAJORITY_THRESHOLD) return gender;
  }
  return null;
}

/**
 * True when a product is acceptable in the footwear slot.
 *
 * Footwear article types are restricted to a known-good allow-list so the slot
 * never fills with the wrong category (or wrong-gender styles). Women-specific
 * styles (Flats, Heels) are permitted when the dominant gender is "Women" or
 * unknown; men's outfits reject them. Non-footwear products are unaffected.
 */
function isAcceptableFootwear(
  product: RankedProduct,
  gender: string | null,
): boolean {
  const category =
    product.outfit_category ?? classifyArticleType(product.article_type);
  if (category !== "footwear") return true;

  const articleType = (product.article_type ?? "").toLowerCase();
  const allowed =
    gender === "Men"
      ? FOOTWEAR_ALLOWED_BASE
      : [...FOOTWEAR_ALLOWED_BASE, ...FOOTWEAR_ALLOWED_WOMEN_EXTRA];
  return allowed.includes(articleType);
}

/**
 * The product of {@link refineCandidates}: everything {@link groupOutfit} needs
 * to build an occasion-appropriate outfit while keeping a safety net.
 */
export interface RefinedCandidates {
  /**
   * Gender-filtered + footwear-validated candidates, *before* occasion
   * filtering. Used as the per-slot fallback so a strict occasion rule can
   * never produce an empty slot.
   */
  genderFiltered: RankedProduct[];
  /**
   * {@link RefinedCandidates.genderFiltered} after the global (slot-agnostic)
   * occasion filter. This is the list the UI shows and that is grouped into the
   * outfit. Identical to `genderFiltered` when no occasion rule is active.
   */
  refined: RankedProduct[];
  /**
   * The active occasion rule (already confidence-gated), or null when there is
   * no occasion match or confidence is below
   * {@link OCCASION_CONFIDENCE_THRESHOLD}. Forwarded to {@link groupOutfit} so
   * per-slot whitelists are enforced.
   */
  occasionRule: OccasionRule | null;
}

/**
 * Refine the merged candidate list before it is grouped into an outfit:
 *   1. Infer the dominant gender from the top products; if one exists, drop
 *      every product of the other gender.
 *   2. Validate the footwear slot, removing any footwear whose article type is
 *      not in the (gender-aware) allow-list.
 *   3. Resolve the occasion rule from `intent.occasion`. When a rule matches and
 *      `intent.confidence >= OCCASION_CONFIDENCE_THRESHOLD`, apply the global
 *      (slot = null) occasion filter to drop article/usage types that are
 *      inappropriate for the occasion regardless of slot.
 *
 * Non-footwear, correct-gender, occasion-appropriate products pass through and
 * keep their incoming relevance order.
 */
export function refineCandidates(
  products: RankedProduct[],
  intent?: QueryIntent,
): RefinedCandidates {
  const explicitGender = intent?.gender ? mapIntentGender(intent.gender) : undefined;
  const gender = explicitGender ?? inferDominantGender(products);
  const genderScoped = gender
    ? products.filter((p) => p.gender === gender)
    : products;
  const genderFiltered = genderScoped.filter((p) =>
    isAcceptableFootwear(p, gender),
  );

  // Occasion filtering only activates with a recognised occasion AND enough
  // confidence — a low-confidence guess shouldn't aggressively prune results.
  const rule = matchOccasion(intent?.occasion);
  const confident = (intent?.confidence ?? 0) >= OCCASION_CONFIDENCE_THRESHOLD;
  const occasionRule = rule && confident ? rule : null;

  const refined = occasionRule
    ? applyOccasionFilter(genderFiltered, occasionRule, null)
    : genderFiltered;

  return { genderFiltered, refined, occasionRule };
}

/** A reusable empty outfit (all slots present, no products). */
export { EMPTY_OUTFIT };
