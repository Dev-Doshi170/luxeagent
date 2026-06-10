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
import { pipeline } from "@xenova/transformers";
import { expandQuery } from "@/lib/queryExpansion";
import type { Product } from "@/types/product";

type FeatureExtractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let embedder: FeatureExtractor | null = null;

async function getEmbedder(): Promise<FeatureExtractor> {
  if (!embedder) {
    embedder = (await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    )) as FeatureExtractor;
  }
  return embedder;
}

/** Embed text into a 384-dim MiniLM vector (mean-pooled + normalized). */
export async function getEmbedding(text: string): Promise<number[]> {
  const extractor = await getEmbedder();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
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
