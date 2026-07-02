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
import { computeBM25Score } from "./bm25.ts";

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

const LUXURY_BRANDS = {
  high: [
    "gucci", "prada", "louis vuitton", "chanel", "hermes", "versace",
    "burberry", "dior", "fendi", "givenchy", "balenciaga", "valentino"
  ],
  mid: [
    "ralph lauren", "tommy hilfiger", "calvin klein", "michael kors",
    "coach", "kate spade", "diesel", "armani", "hugo boss",
    "u.s. polo", "us polo", "levis", "levi's"
  ],
  entry: [
    "zara", "mango", "forever 21", "h&m", "marks & spencer",
    "peter england", "arrow", "van heusen", "raymond", "park avenue"
  ]
};

function computeLuxuryScore(brand: string | null, name: string | null): number {
  const textParts = [brand, name].filter((v): v is string => typeof v === "string");
  if (textParts.length === 0) return 0.1;
  const nameLower = textParts.join(" ").toLowerCase();

  for (const b of LUXURY_BRANDS.high) {
    if (nameLower.includes(b)) return 1.0;
  }
  for (const b of LUXURY_BRANDS.mid) {
    if (nameLower.includes(b)) return 0.6;
  }
  for (const b of LUXURY_BRANDS.entry) {
    if (nameLower.includes(b)) return 0.3;
  }
  return 0.1;
}

function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  if (range < 1e-9) {
    return scores.map(() => 1.0);
  }
  return scores.map(v => (v - min) / range);
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
  let embedding: number[] | null = null;

  try {
    embedding = await getEmbedding(expanded);
  } catch (embedError) {
    console.warn(
      "[Search] Embedding failed; falling back to DB-only search:",
      embedError instanceof Error ? embedError.message : embedError,
    );
  }

  const candidateLimit = Math.max(topK * 4, 150);

  let rawCandidates: any[] = [];

  try {
    if (!embedding) {
      // No embedding available — skip RPC and go straight to direct query
      throw new Error("Embedding unavailable; using direct DB query");
    }

    const { data, error } = await supabase.rpc("hybrid_search", {
      query_embedding: `[${embedding.join(",")}]`,
      query_text: expanded,
      match_count: candidateLimit,
      filter_gender: filters.gender ?? undefined,
      filter_article_type: filters.articleType ?? undefined,
      filter_colour: filters.colour ?? undefined,
      filter_brand_tier: filters.brandTier ?? undefined,
    });

    if (error) throw error;
    rawCandidates = data ?? [];
  } catch (rpcError) {
    console.error(
      "[Search Failsafe] Supabase hybrid_search RPC failed or timed out. Falling back to direct Postgrest query:",
      rpcError,
    );

    const queryBuilder = supabase
      .from("products")
      .select("id, name, gender, article_type, colour, usage_type, image_url, brand, brand_tier, embedding_text");

    if (filters.gender) {
      queryBuilder.ilike("gender", filters.gender);
    }
    if (filters.articleType) {
      queryBuilder.ilike("article_type", filters.articleType);
    }
    if (filters.colour) {
      queryBuilder.ilike("colour", filters.colour);
    }
    if (filters.brandTier) {
      queryBuilder.ilike("brand_tier", filters.brandTier);
    }

    const { data: fallbackData, error: fallbackError } = await queryBuilder.limit(candidateLimit);
    if (fallbackError) {
      console.error("[Search Failsafe] Direct Postgrest fallback also failed:", fallbackError);
      throw fallbackError;
    }
    rawCandidates = fallbackData ?? [];
  }

  if (rawCandidates.length === 0) {
    return [];
  }

  // Calculate BM25 scores
  const bm25RawScores = rawCandidates.map(p =>
    computeBM25Score(p.embedding_text || p.name || "", expanded)
  );

  // Calculate luxury scores
  const luxuryScores = rawCandidates.map(p =>
    computeLuxuryScore(p.brand || null, p.name || null)
  );

  // Extract semantic scores (default to 0.6 if missing, e.g. in fallback query)
  const semanticRawScores = rawCandidates.map(p =>
    p.semantic_score !== undefined ? parseFloat(p.semantic_score) : 0.6
  );

  // Normalize all scores to [0, 1] range
  const semanticNorm = normalizeScores(semanticRawScores);
  const bm25Norm = normalizeScores(bm25RawScores);
  const luxuryNorm = normalizeScores(luxuryScores);

  // Blend normalized scores using the standard weights (0.60 semantic, 0.25 BM25, 0.15 luxury)
  const scoredCandidates: Product[] = rawCandidates.map((p, idx) => {
    const sem = semanticNorm[idx];
    const bm = bm25Norm[idx];
    const lux = luxuryNorm[idx];
    const finalScore = 0.60 * sem + 0.25 * bm + 0.15 * lux;

    return {
      id: p.id,
      name: p.name || "",
      brand: p.brand || null,
      brand_tier: p.brand_tier || null,
      gender: p.gender || "",
      article_type: p.article_type || "",
      colour: p.colour || "",
      usage_type: p.usage_type || "",
      image_url: p.image_url || "",
      semantic_score: parseFloat(sem.toFixed(4)),
      keyword_score: parseFloat(bm.toFixed(4)),
      luxury_score: parseFloat(lux.toFixed(4)),
      final_score: parseFloat(finalScore.toFixed(4)),
    };
  });

  // Sort descending by the true blended final score and return topK
  return scoredCandidates
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, topK);
}
