import { NextRequest, NextResponse } from "next/server";
import { expandQuery } from "@/lib/queryExpansion";
import {
  parseQuery,
  parseWithLLMCached,
  mergeIntents,
  isGeminiCircuitOpen,
  geminiCircuitCooldownRemainingMs,
  type QueryIntent,
} from "@/lib/query-parser";
import { expandIntent, describeOntologyMatch } from "@/lib/query-expander";
import { orchestrateRetrieval } from "@/lib/retrieval-orchestrator";
import {
  createSearchClient,
  getEmbedding,
  mapIntentGender,
  runHybridSearch,
} from "@/lib/hybrid-search";
import { resolveBrandTier } from "@/lib/brandTier";

/**
 * Legacy combined search endpoint (`GET /api/search`).
 * ---------------------------------------------------
 * Retained for backward compatibility (external callers, the chat tool). New
 * surfaces use the dedicated `/api/product-search` (deterministic) and
 * `/api/outfit` (Query Understanding + grouping) endpoints instead. The actual
 * retrieval primitives now live in `@/lib/hybrid-search` so there is a single
 * implementation of search across all three routes.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const topK = parseInt(searchParams.get("top_k") || "10");
  const gender = searchParams.get("gender") || null;
  const articleType = searchParams.get("article_type") || null;
  const colour = searchParams.get("colour") || null;

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter q" }, { status: 400 });
  }

  try {
    const supabase = createSearchClient();

    // ---- Query Understanding Layer ----------------------------------------
    // Parse the free-form styling request into a structured intent, then expand
    // it into concrete catalog terms. The layer is built so it can only ever
    // *add* signal on top of the legacy flow: expansion always includes the raw
    // query, and any failure degrades gracefully to the legacy single search.
    let fallbackReason: string | null = null;

    let intent: QueryIntent = parseQuery(query);
    console.log("[QUL] parsed intent:", JSON.stringify(intent), `(confidence ${intent.confidence})`);

    // Gemini parsing is COMPULSORY — every query is escalated to the LLM parser
    // and merged over the rule-based intent, regardless of confidence. The only
    // time we skip is when the circuit breaker is open (post-429 cooldown), where
    // we transparently keep the rule-based intent rather than worsening the rate
    // limit. Any Gemini failure is swallowed so the rule parser alone still yields
    // a valid, non-degraded search.
    if (isGeminiCircuitOpen()) {
      const secs = Math.ceil(geminiCircuitCooldownRemainingMs() / 1000);
      fallbackReason = `gemini circuit open (~${secs}s left); rule-based intent only`;
      console.log(`[QUL] ⛔ SKIPPING GEMINI — circuit open (~${secs}s left); using rule-based intent.`);
    } else {
      console.log(`[QUL] 🤖 CALLING GEMINI (compulsory) for query: "${query}"`);
      try {
        const llmIntent = await parseWithLLMCached(query);
        intent = mergeIntents(intent, llmIntent);
        console.log("[QUL] ✅ GEMINI SUCCEEDED — merged intent:", JSON.stringify(intent));
      } catch (llmError) {
        fallbackReason = `gemini failed: ${llmError instanceof Error ? llmError.message : String(llmError)}`;
        console.log("[QUL] ⚠️ GEMINI FAILED; falling back to rule-based intent:", fallbackReason);
      }
    }

    console.log("[QUL] ontology match:", describeOntologyMatch(intent));

    // Expand the intent into concrete terms. Expansion is guaranteed non-empty
    // because we pass the raw query as a fallback term; if it somehow throws we
    // still degrade to searching the original query (never worse than legacy).
    let expandedTerms: string[];
    try {
      expandedTerms = expandIntent(intent, { originalQuery: query });
      if (expandedTerms.length === 0) {
        expandedTerms = [query];
        fallbackReason = fallbackReason ?? "expansion produced no terms; using raw query";
      }
    } catch (expandError) {
      expandedTerms = [query];
      fallbackReason = `expansion threw (${expandError instanceof Error ? expandError.message : String(expandError)}); using raw query`;
      console.warn("[QUL] expansion failed; using raw query:", fallbackReason);
    }
    console.log("[QUL] expanded terms:", JSON.stringify(expandedTerms));

    // Multi-search path. Because expandedTerms always contains the raw query,
    // this retrieves a superset of the legacy candidates. We pull at least topK
    // per term so the original-query results are fully represented.
    {
      try {
        const filters = {
          gender: gender ?? mapIntentGender(intent.gender),
          articleType,
          colour,
          brandTier: resolveBrandTier(intent?.style),
        };

        const result = await orchestrateRetrieval({
          searchTerms: expandedTerms,
          topK,
          perTermK: Math.max(topK, 4),
          searchFn: (term, k) => runHybridSearch(supabase, term, k, filters),
        });

        console.debug("[QUL] retrieval counts:", JSON.stringify(result.retrievalCounts));
        console.debug("[QUL] merged unique:", result.mergedCount);
        console.log("[QUL] final results:", result.products.length);

        // If the orchestrator found nothing, fall through to the legacy path
        // rather than returning an empty response.
        if (result.products.length > 0) {
          return NextResponse.json({
            query,
            strategy: "query-understanding",
            intent,
            expanded_terms: expandedTerms,
            fallback_reason: fallbackReason,
            total: result.products.length,
            products: result.products,
          });
        }

        fallbackReason = "multi-search returned no results; using legacy fallback";
        console.log(`[QUL] ${fallbackReason}`);
      } catch (qulError) {
        // Never let the new layer break search — log and fall back.
        fallbackReason = `multi-search failed (${qulError instanceof Error ? qulError.message : String(qulError)}); using legacy fallback`;
        console.warn("[QUL] multi-search failed; using legacy fallback:", qulError);
      }
    }

    // ---- Legacy single-search fallback ------------------------------------
    console.log("[QUL] fallback reason:", fallbackReason ?? "(none)");
    const expandedQuery = expandQuery(query);

    let legacyProducts: any[] = [];

    try {
      const embedding = await getEmbedding(expandedQuery);

      const { data, error } = await supabase.rpc("hybrid_search", {
        query_embedding: `[${embedding.join(",")}]`,
        query_text: expandedQuery,
        match_count: topK,
        filter_gender: gender ?? undefined,
        filter_article_type: articleType ?? undefined,
        filter_colour: colour ?? undefined,
        filter_brand_tier: resolveBrandTier(intent?.style) ?? undefined,
      });

      if (error) throw error;
      legacyProducts = data || [];
    } catch (embeddingError) {
      // Voyage / embedding is down — degrade to a direct text query so
      // the user still gets results instead of a 500.
      console.warn(
        "[QUL] Legacy embedding/RPC failed; falling back to direct DB query:",
        embeddingError instanceof Error ? embeddingError.message : embeddingError,
      );

      const queryBuilder = supabase
        .from("products")
        .select("id, name, gender, article_type, colour, usage_type, image_url, brand, brand_tier, embedding_text")
        .textSearch("embedding_text", expandedQuery.split(/\s+/).join(" & "), { type: "plain" });

      if (gender) queryBuilder.eq("gender", gender);
      if (articleType) queryBuilder.eq("article_type", articleType);
      if (colour) queryBuilder.eq("colour", colour);
      const tierFilter = resolveBrandTier(intent?.style);
      if (tierFilter) queryBuilder.eq("brand_tier", tierFilter);

      const { data: directData, error: directError } = await queryBuilder.limit(topK * 3);

      if (directError) {
        console.warn("[QUL] Direct text query also failed:", directError);
        // Last resort: simple ilike search
        const fallbackBuilder = supabase
          .from("products")
          .select("id, name, gender, article_type, colour, usage_type, image_url, brand, brand_tier, embedding_text")
          .or(
            query.split(/\s+/).map(w => `name.ilike.%${w}%`).join(",")
          );
        if (gender) fallbackBuilder.eq("gender", gender);
        if (articleType) fallbackBuilder.eq("article_type", articleType);

        const { data: ilikeFallback } = await fallbackBuilder.limit(topK * 3);
        legacyProducts = ilikeFallback || [];
      } else {
        legacyProducts = directData || [];
      }

      // Trim to topK (no semantic scoring available, just return first N)
      legacyProducts = legacyProducts.slice(0, topK);
    }

    return NextResponse.json({
      query,
      strategy: "legacy-text-only",
      expanded_query: expandedQuery,
      fallback_reason: fallbackReason ?? "embedding service unavailable",
      total: legacyProducts.length,
      products: legacyProducts,
    });
  } catch (err: unknown) {
    console.error("Search error:", err);
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
