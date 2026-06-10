/**
 * Shared Hybrid Search Helpers
 * ----------------------------
 * The single home for the production search primitives used by every search
 * surface (Product Search, Outfit Creator, and the legacy `/api/search`).
 *
 * Keeping these here guarantees there is exactly ONE implementation of:
 *   - the in-process MiniLM embedder (cached across requests),
 *   - the Supabase `hybrid_search` RPC call (expand -> embed -> search),
 *   - the Supabase service client factory,
 *   - the intent-gender -> catalog-gender mapping.
 *
 * Both the deterministic Product Search path and the Outfit Creator's
 * multi-search orchestrator inject {@link runHybridSearch}, so no caller ever
 * re-implements catalog retrieval.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expandQuery } from "@/lib/queryExpansion";
import type { Product } from "@/types/product";

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(
    "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
    }
  );
  if (!response.ok) {
    throw new Error(`HuggingFace embedding failed: ${response.statusText}`);
  }
  const data = await response.json();
  // HF returns number[][] for batch or number[] for single input
  const vector = Array.isArray(data[0]) ? data[0] : data;
  return vector as number[];
}

/** Create a service-role Supabase client for server-side search. */
export function createSearchClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );
}

/** Map the parser's canonical gender onto the catalog's exact casing. */
export function mapIntentGender(gender: string | undefined): string | null {
  if (gender === "men") return "Men";
  if (gender === "women") return "Women";
  return null;
}

/** Optional catalog filters shared by both search paths. */
export interface SearchFilters {
  gender: string | null;
  articleType: string | null;
  colour: string | null;
  /** Brand tier ('budget' | 'mid' | 'premium'); null means all tiers. */
  brandTier: string | null;
}

/**
 * Run a single hybrid search: expand the term, embed it, and call the Supabase
 * `hybrid_search` RPC. Shared by the deterministic Product Search path and the
 * Outfit Creator's multi-search orchestrator (the latter calls it once per
 * expanded term).
 */
export async function runHybridSearch(
  supabase: SupabaseClient,
  term: string,
  topK: number,
  filters: SearchFilters,
): Promise<Product[]> {
  const expanded = expandQuery(term);
  const embedding = await getEmbedding(expanded);

  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: `[${embedding.join(",")}]`,
    query_text: expanded,
    match_count: topK,
    filter_gender: filters.gender ?? undefined,
    filter_article_type: filters.articleType ?? undefined,
    filter_colour: filters.colour ?? undefined,
    filter_brand_tier: filters.brandTier ?? undefined,
  });

  if (error) throw error;
  return (data ?? []) as Product[];
}
