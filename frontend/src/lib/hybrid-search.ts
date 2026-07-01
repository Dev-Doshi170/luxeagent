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
import { expandQuery } from "./queryExpansion.ts";
import type { Product } from "../types/product.ts";

/**
 * Embed a query with Voyage AI (`voyage-3-lite`, 512 dims).
 *
 * The returned vector is compared against the `text_embedding` column in
 * Supabase, so the catalog MUST be embedded with the *same* model. Mixing
 * models (or truncating one model's output to another's dimension) silently
 * produces garbage similarity scores, since embeddings only live in a shared
 * space when they come from the same model. The corpus is re-embedded with
 * `voyage-3-lite` via `scripts/reembed_voyage.py`; do NOT truncate here.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [text],
      model: "voyage-3-lite",
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voyage embedding failed: ${err}`);
  }
  const data = await response.json();
  return data.data[0].embedding as number[];
}

/**
 * Generate image embeddings from the CLIP microservice.
 * Accepts a base64 image data URL or a remote image URL.
 */
export async function getClipEmbedding(imageInput: string): Promise<number[]> {
  const clipServiceUrl = process.env.CLIP_SERVICE_URL || "http://localhost:8001";
  
  let blob: Blob;
  
  if (imageInput.startsWith("data:")) {
    const matches = imageInput.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error("Invalid base64 image format");
    }
    const contentType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");
    blob = new Blob([buffer], { type: contentType });
  } else {
    const res = await fetch(imageInput);
    if (!res.ok) {
      throw new Error(`Failed to fetch image from URL: ${res.statusText}`);
    }
    blob = await res.blob();
  }
  
  const formData = new FormData();
  formData.append("file", blob, "image.jpg");
  
  const response = await fetch(`${clipServiceUrl}/embed`, {
    method: "POST",
    body: formData,
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`CLIP service returned status ${response.status}: ${errText}`);
  }
  
  const data = await response.json();
  return data.embedding as number[];
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

  try {
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
  } catch (rpcError) {
    console.error(
      "[Search Failsafe] Supabase hybrid_search RPC failed or timed out. Falling back to direct Postgrest query:",
      rpcError,
    );

    const queryBuilder = supabase
      .from("products")
      .select("id, name, gender, article_type, colour, usage_type, image_url, brand_tier");

    if (filters.gender) {
      queryBuilder.eq("gender", filters.gender);
    }
    if (filters.articleType) {
      queryBuilder.eq("article_type", filters.articleType);
    }
    if (filters.colour) {
      queryBuilder.eq("colour", filters.colour);
    }
    if (filters.brandTier) {
      queryBuilder.eq("brand_tier", filters.brandTier);
    }

    const { data: fallbackData, error: fallbackError } = await queryBuilder.limit(topK || 12);
    if (fallbackError) {
      console.error("[Search Failsafe] Direct Postgrest fallback also failed:", fallbackError);
      throw fallbackError;
    }

    return (fallbackData ?? []).map((p: any) => ({
      id: p.id,
      name: p.name || "",
      brand: p.brand || null,
      brand_tier: p.brand_tier || null,
      gender: p.gender || "",
      article_type: p.article_type || "",
      colour: p.colour || "",
      usage_type: p.usage_type || "",
      image_url: p.image_url || "",
      semantic_score: 0.6,
      keyword_score: 0.6,
      final_score: 0.6,
    })) as Product[];
  }
}
