/**
 * Outfit Creator Types
 * --------------------
 * Clean, extensible interfaces describing a complete outfit composition and the
 * Outfit Creator API contract. Kept separate from the catalog `Product` type so
 * the grouping/response shape can evolve (e.g. add "outerwear" or per-category
 * styling notes) without touching the core product model.
 */

import type { Product } from "@/types/product";
import type { QueryIntent } from "@/lib/query-parser";

/**
 * The coarse outfit categories surfaced to the UI. Mirrors (a subset of) the
 * orchestrator's {@link import("@/lib/retrieval-orchestrator").OutfitCategory};
 * "other" is intentionally excluded because it is dropped from the outfit.
 */
export type OutfitSlot = "tops" | "bottoms" | "footwear" | "accessories";

/** The order categories should be presented in the UI. */
export const OUTFIT_SLOTS: readonly OutfitSlot[] = [
  "tops",
  "bottoms",
  "footwear",
  "accessories",
];

/** Human-readable labels for each outfit slot. */
export const OUTFIT_SLOT_LABELS: Record<OutfitSlot, string> = {
  tops: "Tops",
  bottoms: "Bottoms",
  footwear: "Footwear",
  accessories: "Accessories",
};

/**
 * A complete outfit composition: catalog products grouped by category.
 * Each array is ordered by relevance and may be empty when the catalog has no
 * matching item for that slot.
 */
export interface Outfit {
  tops: Product[];
  bottoms: Product[];
  footwear: Product[];
  accessories: Product[];
}

/** An empty outfit (all slots present, no products). Convenient default. */
export const EMPTY_OUTFIT: Outfit = {
  tops: [],
  bottoms: [],
  footwear: [],
  accessories: [],
};

/** The full response returned by `POST /api/outfit`. */
export interface OutfitResponse {
  query: string;
  strategy: "query-understanding" | "legacy";
  intent: QueryIntent;
  expanded_terms: string[];
  fallback_reason: string | null;
  /** Grouped outfit composition (what the UI renders). */
  outfit: Outfit;
  /** Flat, de-duplicated ranked products (for debugging / fallback rendering). */
  products: Product[];
  total: number;
}
