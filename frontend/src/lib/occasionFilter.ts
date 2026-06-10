/**
 * Occasion-Aware Filtering
 * ------------------------
 * Turns the parsed {@link QueryIntent.occasion} (e.g. "beach wedding", "office",
 * "diwali") into a concrete set of catalog rules and applies them to the ranked
 * candidate list before it is grouped into an outfit.
 *
 * The pipeline produces relevant products, but "relevant" is not the same as
 * "appropriate": a Tshirt can be a great keyword match for a wedding query yet
 * still be the wrong thing to wear. These rules encode the styling guard-rails
 * the ranker doesn't know about — what article types are off-limits for an
 * occasion, which usage_type values disqualify a product, and which article
 * types belong in the footwear / tops slots.
 *
 * Design goals (mirrors the rest of the Query Understanding Layer):
 *   - Pure data tables (the {@link OCCASION_RULES} dictionary) so new occasions
 *     and vocabulary can be added without touching logic.
 *   - Deterministic, dependency-free, synchronous, and fully unit-testable.
 *   - Case-insensitive, partial keyword matching so it lines up with whatever
 *     occasion string the rule-based parser or Gemini emits.
 */

import type { RankedProduct } from "./retrieval-orchestrator.ts";
import type { OutfitSlot } from "../types/outfit.ts";

/**
 * A single occasion's styling rules. All string lists are matched
 * case-insensitively against catalog `article_type` / `usage_type` values.
 */
export interface OccasionRule {
  /** Substrings that, if present in the occasion field, activate this rule. */
  keywords: string[];
  /** Article types that are never appropriate for this occasion. */
  blocked_article_types: string[];
  /** usage_type values that disqualify a product for this occasion. */
  blocked_usage_types: string[];
  /** Whitelist of article_type values allowed in the footwear slot. */
  allowed_footwear: string[];
  /** Whitelist of article_type values allowed in the tops slot. */
  allowed_tops: string[];
}

/** Below this intent confidence the occasion filter stays dormant. */
export const OCCASION_CONFIDENCE_THRESHOLD = 0.3;

/**
 * Occasion → rule dictionary.
 *
 * Order matters: it encodes priority from strictest/most-formal to most-relaxed.
 * When an occasion matches several rules (e.g. "beach wedding"), the earlier
 * entry is treated as the primary/stricter rule during {@link mergeRules}
 * (WEDDING wins over BEACH).
 */
export const OCCASION_RULES: Record<string, OccasionRule> = {
  WEDDING_FORMAL: {
    keywords: ["wedding", "gala", "black tie", "cocktail", "reception", "engagement"],
    blocked_article_types: [
      "Tshirts", "Shorts", "Tracksuits", "Sweatshirts", "Capris", "Leggings", "Swimwear", "Nightwear",
    ],
    blocked_usage_types: [],
    allowed_footwear: ["Heels", "Flats", "Loafers", "Casual Shoes", "Shoes", "Sandals"],
    allowed_tops: ["Shirts", "Blazers", "Jackets", "Kurtas", "Tops", "Dresses", "Sarees", "Lehenga Choli"],
  },
  OFFICE_WORK: {
    keywords: ["office", "work", "meeting", "corporate", "business", "interview", "professional"],
    blocked_article_types: [
      "Tshirts", "Shorts", "Swimwear", "Nightwear", "Tracksuits", "Leggings",
    ],
    blocked_usage_types: [],
    allowed_footwear: ["Shoes", "Loafers", "Heels", "Flats", "Casual Shoes"],
    allowed_tops: ["Shirts", "Blazers", "Tops", "Jackets", "Suits", "Kurtas"],
  },
  ETHNIC_FESTIVE: {
    keywords: [
      "diwali", "eid", "puja", "festival", "festive", "haldi", "mehndi", "sangeet", "traditional", "ethnic",
    ],
    blocked_article_types: [
      "Tshirts", "Shorts", "Tracksuits", "Swimwear", "Jeans", "Sweatshirts",
    ],
    blocked_usage_types: [],
    allowed_footwear: ["Flats", "Heels", "Sandals", "Shoes"],
    allowed_tops: ["Kurtas", "Sarees", "Lehenga Choli", "Tops", "Shirts", "Dresses"],
  },
  PARTY_NIGHT_OUT: {
    keywords: ["party", "night out", "club", "date night", "dinner", "cocktail"],
    blocked_article_types: ["Tracksuits", "Nightwear", "Swimwear", "Sports Shoes"],
    blocked_usage_types: [],
    allowed_footwear: ["Heels", "Sandals", "Loafers", "Shoes", "Casual Shoes"],
    allowed_tops: ["Tops", "Dresses", "Shirts", "Blazers", "Kurtas", "Lehenga Choli"],
  },
  SPORTS_GYM: {
    keywords: ["gym", "workout", "running", "hiking", "sport", "yoga", "fitness", "trek"],
    blocked_article_types: [
      "Sarees", "Lehenga Choli", "Suits", "Blazers", "Heels", "Formal Shoes",
    ],
    blocked_usage_types: [],
    allowed_footwear: ["Sports Shoes", "Sandals"],
    allowed_tops: ["Tshirts", "Tops", "Tracksuits", "Sweatshirts"],
  },
  BEACH_RESORT: {
    keywords: ["beach", "resort", "pool", "vacation", "holiday", "goa", "maldives", "bali"],
    blocked_article_types: ["Blazers", "Suits", "Tracksuits", "Nightwear", "Sweatshirts"],
    blocked_usage_types: [],
    allowed_footwear: ["Sandals", "Flats", "Flip Flops", "Sports Shoes"],
    allowed_tops: ["Shirts", "Tshirts", "Tops", "Dresses", "Kurtas", "Sarees", "Shorts", "Swimwear"],
  },
  CASUAL_EVERYDAY: {
    keywords: ["casual", "everyday", "weekend", "brunch", "coffee", "errands"],
    blocked_article_types: ["Swimwear", "Nightwear", "Tracksuits"],
    blocked_usage_types: [],
    allowed_footwear: [],
    allowed_tops: [],
  },
};

const lower = (value: string): string => value.toLowerCase().trim();

/** Case-insensitive de-duplicating union, preserving `a`'s ordering first. */
function unionLists(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...a, ...b]) {
    const key = lower(item);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Case-insensitive intersection that treats an empty list as "no restriction".
 *
 * - If either side is empty, the other side wins (an empty whitelist/required
 *   list means "anything goes", so the non-empty constraint is the stricter one).
 * - When both are non-empty but share nothing, we keep `a` (the primary, higher
 *   priority rule) rather than collapsing to an empty — an empty list here would
 *   silently disable the constraint, which is the opposite of "stricter wins".
 */
function intersectLists(a: string[], b: string[]): string[] {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  const bKeys = new Set(b.map(lower));
  const inter = a.filter((item) => bKeys.has(lower(item)));
  return inter.length ? inter : [...a];
}

/**
 * Fold several matched rules into one. Blocked lists are unioned (any rule that
 * forbids something forbids it for the combination); allowed lists are
 * intersected so the stricter constraint wins (see {@link intersectLists}).
 * `rules` must be ordered primary-first (stricter occasion before looser).
 */
function mergeRules(rules: OccasionRule[]): OccasionRule {
  return rules.reduce((acc, rule) => ({
    keywords: unionLists(acc.keywords, rule.keywords),
    blocked_article_types: unionLists(acc.blocked_article_types, rule.blocked_article_types),
    blocked_usage_types: unionLists(acc.blocked_usage_types, rule.blocked_usage_types),
    allowed_footwear: intersectLists(acc.allowed_footwear, rule.allowed_footwear),
    allowed_tops: intersectLists(acc.allowed_tops, rule.allowed_tops),
  }));
}

/**
 * Resolve an occasion string to the rule(s) that govern it.
 *
 * Matching is case-insensitive and partial: a rule fires when any of its
 * keywords appears anywhere in the occasion field. When several rules match
 * (e.g. "beach wedding" hits both WEDDING and BEACH) they are merged with the
 * stricter occasion (the one earlier in {@link OCCASION_RULES}) as the primary.
 *
 * @returns the governing rule, or null when the occasion is empty/unrecognised.
 */
export function matchOccasion(
  occasion: string | undefined | null,
): OccasionRule | null {
  if (!occasion) return null;
  const haystack = lower(occasion);
  if (!haystack) return null;

  // Iterate OCCASION_RULES in declaration order so matches stay priority-ordered.
  const matched = Object.values(OCCASION_RULES).filter((rule) =>
    rule.keywords.some((keyword) => haystack.includes(lower(keyword))),
  );

  if (matched.length === 0) return null;
  if (matched.length === 1) return matched[0];
  return mergeRules(matched);
}

/**
 * Apply an occasion rule to a list of ranked candidates.
 *
 * Removes products that are inappropriate for the occasion:
 *   - article_type in `blocked_article_types`
 *   - usage_type in `blocked_usage_types`
 *   - for slot "footwear": article_type not in `allowed_footwear` (when non-empty)
 *   - for slot "tops": article_type not in `allowed_tops` (when non-empty)
 *
 * Pass `slot = null` to apply only the global (occasion-wide) constraints, which
 * is how {@link refineCandidates} strips globally-blocked types before grouping.
 * All comparisons are case-insensitive. Input order is preserved.
 */
export function applyOccasionFilter(
  products: RankedProduct[],
  rule: OccasionRule,
  slot: OutfitSlot | null,
): RankedProduct[] {
  const blockedArticles = new Set(rule.blocked_article_types.map(lower));
  const blockedUsage = new Set(rule.blocked_usage_types.map(lower));
  const allowedFootwear = new Set(rule.allowed_footwear.map(lower));
  const allowedTops = new Set(rule.allowed_tops.map(lower));

  return products.filter((product) => {
    const articleType = lower(product.article_type ?? "");
    const usageType = lower(product.usage_type ?? "");

    if (blockedArticles.has(articleType)) return false;
    if (blockedUsage.has(usageType)) return false;

    if (slot === "footwear" && allowedFootwear.size > 0 && !allowedFootwear.has(articleType)) {
      return false;
    }
    if (slot === "tops" && allowedTops.size > 0 && !allowedTops.has(articleType)) {
      return false;
    }

    return true;
  });
}
