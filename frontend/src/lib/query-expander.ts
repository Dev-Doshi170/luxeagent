/**
 * Query Expansion Engine
 * ----------------------
 * Turns a structured {@link QueryIntent} into a concrete list of catalog
 * search terms using the {@link FASHION_ONTOLOGY}.
 *
 *   { occasion: "beach wedding", style: "luxury" }
 *     ->
 *   ["linen shirt", "beige chinos", "summer blazer", "loafers"]
 *
 * Fallback chain (most specific to least):
 *   1. ontology[occasion][style]      — style-specific outfit
 *   2. ontology[occasion].default     — generic outfit for the occasion
 *   3. intent.searchTerms             — nouns the user named directly
 *   4. []                             — caller should fall back to raw query
 *
 * Season modifiers and user-named terms/colors are merged in as additional
 * hints so we never *lose* signal the user gave us.
 */

import type { QueryIntent } from "./query-parser.ts";
import {
  FASHION_ONTOLOGY,
  SEASON_MODIFIERS,
  type FashionOntology,
} from "./fashion-ontology.ts";

export interface ExpandOptions {
  /** Override the ontology (useful for tests / A-B experiments). */
  ontology?: FashionOntology;
  /** Cap on the number of terms returned (keeps multi-search bounded). */
  maxTerms?: number;
  /** Whether to fold in season modifiers (e.g. "linen", "wool"). */
  applySeasonModifiers?: boolean;
  /**
   * The user's raw query. When provided it is *always* included as a search
   * term. This guarantees two invariants:
   *   1. The expanded term list is never empty (req: never return nothing).
   *   2. The multi-search is a strict superset of the legacy single-search, so
   *      the Query Understanding Layer can never retrieve fewer relevant items
   *      than the old flow would have.
   */
  originalQuery?: string;
}

const DEFAULT_MAX_TERMS = 8;

/**
 * Remove duplicate words from a single search term while preserving order.
 * Prefixing season modifiers / color hints onto base terms can produce
 * accidental repeats like "linen linen shirt" or "beige beige chinos"; this
 * collapses them to "linen shirt" / "beige chinos" (case-insensitive compare).
 */
function dedupeWords(term: string): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of term.split(/\s+/)) {
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words.join(" ");
}

/** Describes which ontology bucket (if any) an intent resolves to. For logs. */
export function describeOntologyMatch(
  intent: QueryIntent,
  ontology: FashionOntology = FASHION_ONTOLOGY,
): string {
  if (!intent.occasion) return "none (no occasion parsed)";
  const occasionMap = ontology[intent.occasion];
  if (!occasionMap) return `none (occasion "${intent.occasion}" not in ontology)`;
  const styleHit = intent.style && occasionMap[intent.style]?.length;
  const bucket = styleHit ? intent.style : "default";
  const count = (styleHit ? occasionMap[intent.style!] : occasionMap.default).length;
  return `${intent.occasion}/${bucket} (${count} terms)`;
}

/** Look up the best-matching term list for an occasion + style. */
function lookupOccasionTerms(
  intent: QueryIntent,
  ontology: FashionOntology,
): string[] {
  if (!intent.occasion) return [];
  const occasionMap = ontology[intent.occasion];
  if (!occasionMap) return [];

  // Prefer the style-specific list, fall back to default.
  if (intent.style && occasionMap[intent.style]?.length) {
    return [...occasionMap[intent.style]];
  }
  return [...occasionMap.default];
}

/**
 * Prefix a color onto base apparel terms so we search e.g. "beige linen shirt"
 * rather than discarding the color signal. Only applied to a couple of terms to
 * avoid over-constraining every search.
 */
function applyColorHints(terms: string[], colors: string[]): string[] {
  if (!colors.length) return terms;
  const primaryColor = colors[0];
  return terms.map((term, index) =>
    index < 2 ? `${primaryColor} ${term}` : term,
  );
}

/**
 * Expand a parsed intent into searchable catalog terms.
 * Returns an empty array when there's nothing actionable (caller then falls
 * back to embedding the raw query, preserving existing behavior).
 */
export function expandIntent(
  intent: QueryIntent,
  options: ExpandOptions = {},
): string[] {
  const {
    ontology = FASHION_ONTOLOGY,
    maxTerms = DEFAULT_MAX_TERMS,
    applySeasonModifiers = true,
    originalQuery,
  } = options;

  let terms = lookupOccasionTerms(intent, ontology);

  // Fall back to user-named nouns when the ontology has nothing for us.
  if (terms.length === 0 && intent.searchTerms?.length) {
    terms = [...intent.searchTerms];
  } else if (intent.searchTerms?.length) {
    // Otherwise still merge explicit nouns the user asked for.
    terms = [...terms, ...intent.searchTerms];
  }

  // Color hints (e.g. "beige linen shirt").
  if (intent.colors?.length) {
    terms = applyColorHints(terms, intent.colors);
  }

  // Season modifiers as extra standalone hint terms.
  if (applySeasonModifiers && intent.season) {
    const modifiers = SEASON_MODIFIERS[intent.season] ?? [];
    if (modifiers.length && terms.length) {
      // Attach the strongest modifier to the lead garment for specificity.
      terms = [`${modifiers[0]} ${terms[0]}`, ...terms.slice(1)];
    }
  }

  // Dedupe (case-insensitive) and bound the count.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(dedupeWords(term.trim()));
    if (deduped.length >= maxTerms) break;
  }

  // Always cover the raw query. This guarantees the result is non-empty and
  // that the multi-search retrieves at least everything the legacy single
  // search would have (no quality regression). It is appended last so the
  // ontology-derived terms still lead the search, and it may exceed maxTerms by
  // one to ensure the guarantee always holds.
  const fallbackTerm = originalQuery?.trim();
  if (fallbackTerm && !seen.has(fallbackTerm.toLowerCase())) {
    deduped.push(fallbackTerm);
  }

  return deduped;
}
