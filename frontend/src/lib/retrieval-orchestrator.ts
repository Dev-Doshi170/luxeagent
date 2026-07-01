/**
 * Retrieval Orchestrator
 * ----------------------
 * The conductor of the Query Understanding Layer. Given a parsed intent and a
 * set of expanded search terms, it:
 *
 *   1. Runs a *separate* catalog search for each term (multi-search retrieval).
 *   2. Merges all hits and de-duplicates by product id.
 *   3. Diversifies results into a balanced outfit (tops / bottoms / footwear /
 *      accessories) so we don't return "12 sandals".
 *   4. Re-scores with `0.70 * search_score + 0.30 * diversity_boost`.
 *   5. Returns the top-N, ready for the existing ranking/UI layer.
 *
 * It is deliberately decoupled from Supabase/embeddings via the injected
 * {@link SearchFn}, so it is fully unit-testable and reusable from any caller.
 */

import type { Product } from "@/types/product";

/** Weight of the raw search relevance in the final blended score. */
export const SEARCH_SCORE_WEIGHT = 0.7;
/** Weight of the diversity boost in the final blended score. */
export const DIVERSITY_BOOST_WEIGHT = 0.3;

/** Coarse outfit buckets used for diversification. */
export type OutfitCategory =
  | "tops"
  | "bottoms"
  | "footwear"
  | "accessories"
  | "other";

/** A product annotated with orchestrator bookkeeping. */
export interface RankedProduct extends Product {
  /** The expanded term whose search surfaced this product. */
  matched_term?: string;
  /** Coarse outfit bucket used for diversification. */
  outfit_category?: OutfitCategory;
  /** 0..1 boost that rewards balanced outfit composition. */
  diversity_boost?: number;
}

/**
 * A pluggable search function. Production injects one that embeds the term and
 * calls the Supabase `hybrid_search` RPC; tests inject a stub.
 */
export type SearchFn = (
  term: string,
  topK: number,
) => Promise<Product[]>;

export interface OrchestrateOptions {
  /** The expanded catalog terms to search for, one search per term. */
  searchTerms: string[];
  /** Injected catalog search (embedding + hybrid_search in production). */
  searchFn: SearchFn;
  /** How many products to return overall (flat top-K; ignored when slotAware). */
  topK?: number;
  /** How many candidates to pull per individual term search. */
  perTermK?: number;
  /**
   * Slot-aware candidate selection. When true, instead of returning a flat
   * top-K across all candidates (which a single high-scoring category can
   * dominate — e.g. "7 trousers in the top 12"), the orchestrator keeps the
   * top-N *within each outfit slot* per {@link PER_SLOT_CANDIDATE_LIMIT}. This
   * guarantees every slot has candidates before the downstream gender/occasion
   * filters run, at the cost of a slightly larger result (~20-22). The Outfit
   * Creator opts in; Product Search keeps the flat top-K (a "shoes" search
   * should return many shoes, not be capped to the footwear slot limit).
   */
  slotAware?: boolean;
  /** Optional logger; defaults to console. Pass a no-op to silence. */
  logger?: Pick<Console, "debug" | "warn">;
}

export interface OrchestrateResult {
  products: RankedProduct[];
  /** Per-term retrieval counts, useful for debugging/observability. */
  retrievalCounts: Record<string, number>;
  /** Count after de-duplication (before truncation to topK). */
  mergedCount: number;
}

const DEFAULT_TOP_K = 12;
const DEFAULT_PER_TERM_K = 8;

/**
 * Per-slot caps on how many candidates to forward when slot-aware selection is
 * enabled (see {@link OrchestrateOptions.slotAware}). Selecting top-N *within
 * each slot* — rather than a flat top-K across all candidates — guarantees the
 * tops/bottoms/footwear/accessories slots all have items to choose from before
 * the gender + occasion filters run, so one over-represented category can no
 * longer crowd the others out of the shortlist. Sums to ~22 candidates.
 */
export const PER_SLOT_CANDIDATE_LIMIT: Record<OutfitCategory, number> = {
  tops: 6,
  bottoms: 6,
  footwear: 4,
  accessories: 4,
  other: 2,
};

/**
 * Classify an article type into a coarse outfit bucket.
 * Extend the keyword lists as the catalog grows.
 */
export function classifyArticleType(articleType: string | undefined): OutfitCategory {
  const a = (articleType ?? "").toLowerCase();
  if (!a) return "other";

  const TOPS = ["shirt", "tshirt", "t-shirt", "top", "kurta", "blazer", "jacket", "sweater", "sweatshirt", "blouse", "tunic", "suit", "sherwani"];
  const BOTTOMS = ["trouser", "chino", "jean", "pant", "short", "skirt", "legging", "track"];
  const FOOTWEAR = ["shoe", "loafer", "sneaker", "boot", "sandal", "heel", "flip", "espadrille", "mojari", "flat"];
  const ACCESSORIES = ["watch", "sunglass", "belt", "bag", "handbag", "wallet", "scarf", "tie", "cap", "hat", "jewel", "bracelet", "pocket square"];

  const has = (list: string[]) => list.some((k) => a.includes(k));
  if (has(TOPS)) return "tops";
  if (has(BOTTOMS)) return "bottoms";
  if (has(FOOTWEAR)) return "footwear";
  if (has(ACCESSORIES)) return "accessories";
  return "other";
}

/** Min-max normalize a numeric field into 0..1 (returns all 1s if flat). */
function normalizeScores(products: RankedProduct[]): Map<number, number> {
  const scores = products.map((p) => p.final_score ?? 0);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  const out = new Map<number, number>();
  for (const p of products) {
    const raw = p.final_score ?? 0;
    out.set(p.id, range === 0 ? 1 : (raw - min) / range);
  }
  return out;
}

/**
 * Run every term search in parallel and collect the raw hits.
 * Each product is tagged with the term that surfaced it. Individual term
 * failures are isolated so one bad search can't sink the whole request.
 */
async function multiSearch(
  searchTerms: string[],
  searchFn: SearchFn,
  perTermK: number,
  logger: Pick<Console, "debug" | "warn">,
): Promise<{ hits: RankedProduct[]; retrievalCounts: Record<string, number> }> {
  const retrievalCounts: Record<string, number> = {};

  const settled = await Promise.allSettled(
    searchTerms.map(async (term) => {
      const results = await searchFn(term, perTermK);
      return { term, results };
    }),
  );

  const hits: RankedProduct[] = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      logger.warn("[QUL] term search failed:", outcome.reason);
      continue;
    }
    const { term, results } = outcome.value;
    retrievalCounts[term] = results.length;
    logger.debug(`[QUL] term "${term}" -> ${results.length} results`);
    for (const product of results) {
      hits.push({ ...product, matched_term: term });
    }
  }

  return { hits, retrievalCounts };
}

/**
 * De-duplicate by product id, keeping the occurrence with the highest
 * search relevance (and remembering which term first surfaced it).
 */
function dedupeById(hits: RankedProduct[]): RankedProduct[] {
  const byId = new Map<number, RankedProduct>();
  for (const hit of hits) {
    const existing = byId.get(hit.id);
    if (!existing || (hit.final_score ?? 0) > (existing.final_score ?? 0)) {
      byId.set(hit.id, hit);
    }
  }
  return Array.from(byId.values());
}

/**
 * Assign a diversity boost per product.
 *
 * Strategy: within each outfit category, rank items by relevance; the best item
 * in each category gets the full boost (1.0) while every *additional* item of the
 * same category is suppressed quadratically (rank 1 -> 0.25, rank 2 -> 0.11...).
 *
 * The quadratic falloff is deliberate: it must be steep enough that the diversity
 * term (weighted 0.30) can pull a lower-relevance item from a *missing* category
 * above the 2nd/3rd item of an over-represented one (weighted 0.70). That is what
 * prevents "12 sandals" and yields a balanced outfit (top + bottom + footwear +
 * accessory). Tune the exponent to make diversification more/less aggressive.
 */
function applyDiversityBoost(products: RankedProduct[]): void {
  const byCategory = new Map<OutfitCategory, RankedProduct[]>();
  for (const p of products) {
    const category = classifyArticleType(p.article_type);
    p.outfit_category = category;
    const bucket = byCategory.get(category) ?? [];
    bucket.push(p);
    byCategory.set(category, bucket);
  }

  for (const bucket of byCategory.values()) {
    bucket.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
    bucket.forEach((p, rank) => {
      p.diversity_boost = 1 / (1 + rank) ** 2;
    });
  }
}

/**
 * Slot-aware candidate selection.
 *
 * Groups the (already blended + sorted) candidates by their `outfit_category`
 * and keeps only the top-N within each slot per {@link PER_SLOT_CANDIDATE_LIMIT},
 * then flattens back into a single list re-sorted by `final_score`. Because each
 * product belongs to exactly one category bucket, the flattened list is already
 * de-duplicated. Used instead of a flat `slice(0, topK)` so every outfit slot is
 * represented before the downstream gender/occasion filters run.
 */
function selectSlotAwareCandidates(
  products: RankedProduct[],
): RankedProduct[] {
  const byCategory = new Map<OutfitCategory, RankedProduct[]>();
  for (const p of products) {
    const category = p.outfit_category ?? classifyArticleType(p.article_type);
    const bucket = byCategory.get(category) ?? [];
    bucket.push(p);
    byCategory.set(category, bucket);
  }

  const selected: RankedProduct[] = [];
  for (const [category, bucket] of byCategory) {
    bucket.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
    selected.push(...bucket.slice(0, PER_SLOT_CANDIDATE_LIMIT[category]));
  }

  // groupOutfit re-buckets, but the UI-facing `products` list and the logs
  // should still read best-first.
  selected.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
  return selected;
}

/**
 * Deduplicate, classify, apply diversity boost, normalize scores, and rank products.
 * Extracted into a shared utility function so visual search results can reuse the same pipeline logic.
 */
export function rankAndDiversify(
  merged: RankedProduct[],
  topK: number = DEFAULT_TOP_K,
  slotAware: boolean = false,
): RankedProduct[] {
  // 4. Diversify into balanced outfit buckets.
  applyDiversityBoost(merged);

  // 5. Blend search relevance with diversity boost and sort.
  const normalized = normalizeScores(merged);
  for (const p of merged) {
    const searchScore = normalized.get(p.id) ?? 0;
    const diversity = p.diversity_boost ?? 0;
    p.final_score =
      SEARCH_SCORE_WEIGHT * searchScore + DIVERSITY_BOOST_WEIGHT * diversity;
  }
  merged.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));

  // 6. Final selection. Slot-aware keeps the top-N per outfit slot so no single
  // category can crowd the shortlist; otherwise return the flat top-K.
  return slotAware
    ? selectSlotAwareCandidates(merged)
    : merged.slice(0, topK);
}

/**
 * Orchestrate the full multi-search + merge + diversify + rank pipeline.
 * Returns the blended, sorted candidates plus debug counters. By default this is
 * a flat top-K; pass {@link OrchestrateOptions.slotAware} to instead keep the
 * top-N per outfit slot (see {@link selectSlotAwareCandidates}).
 */
export async function orchestrateRetrieval(
  options: OrchestrateOptions,
): Promise<OrchestrateResult> {
  const {
    searchTerms,
    searchFn,
    topK = DEFAULT_TOP_K,
    perTermK = DEFAULT_PER_TERM_K,
    slotAware = false,
    logger = console,
  } = options;

  if (!searchTerms.length) {
    return { products: [], retrievalCounts: {}, mergedCount: 0 };
  }

  // 1 + 2. Multi-search and tag hits with their source term.
  const { hits, retrievalCounts } = await multiSearch(
    searchTerms,
    searchFn,
    perTermK,
    logger,
  );

  // 3. De-duplicate by product id.
  const merged = dedupeById(hits);
  const mergedCount = merged.length;
  logger.debug(`[QUL] merged ${hits.length} hits -> ${mergedCount} unique`);

  const products = rankAndDiversify(merged, topK, slotAware);

  return {
    products,
    retrievalCounts,
    mergedCount,
  };
}

