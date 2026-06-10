import { NextRequest, NextResponse } from "next/server";
import {
  createSearchClient,
  runHybridSearch,
  mapIntentGender,
} from "@/lib/hybrid-search";
import { resolveBrandTier } from "@/lib/brandTier";
import {
  parseQuery,
  parseWithLLMCached,
  mergeIntents,
  isGeminiCircuitOpen,
  geminiCircuitCooldownRemainingMs,
  type QueryIntent,
} from "@/lib/query-parser";
import { expandIntent, describeOntologyMatch } from "@/lib/query-expander";
import {
  orchestrateRetrieval,
  classifyArticleType,
  type RankedProduct,
} from "@/lib/retrieval-orchestrator";
import { groupOutfit, refineCandidates, EMPTY_OUTFIT } from "@/lib/outfit-builder";
import {
  logSection,
  logProducts,
  categoryBreakdown,
} from "@/lib/search-logger";
import type { OutfitResponse } from "@/types/outfit";

/**
 * Outfit Creator endpoint (`POST /api/outfit`)
 * --------------------------------------------
 * The "help me build a look" path. It runs the full Query Understanding Layer
 * (intent parse -> optional Gemini escalation -> fashion-ontology expansion ->
 * multi-search retrieval -> diversified ranking) and then groups the diversified
 * results into a complete outfit ({ tops, bottoms, footwear, accessories }).
 *
 * It reuses the exact same search primitives as Product Search (shared
 * {@link runHybridSearch}) and the same orchestrator, so the two modes share one
 * catalog and one ranking engine.
 *
 * Body: `{ query: string, top_k?: number, gender?, article_type?, colour? }`.
 * Degrades gracefully: any failure in the layer falls back to a single hybrid
 * search whose results are still grouped into an outfit.
 */
/**
 * Drop "other"-category products so the UI-facing product list only ever
 * contains items that belong to a real outfit slot. Uses the orchestrator's
 * annotation when present and falls back to classifying the article type
 * (legacy single-search results are not annotated).
 */
function dropOtherCategory(products: RankedProduct[]): RankedProduct[] {
  return products.filter(
    (p) =>
      (p.outfit_category ?? classifyArticleType(p.article_type)) !== "other",
  );
}

export async function POST(req: NextRequest) {
  let body: {
    query?: string;
    top_k?: number;
    gender?: string | null;
    article_type?: string | null;
    colour?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  const topK = body.top_k ?? 12;
  const gender = body.gender ?? null;
  const articleType = body.article_type ?? null;
  const colour = body.colour ?? null;

  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const startedAt = Date.now();
  logSection("[Outfit]", "REQUEST RECEIVED");
  console.log(`[Outfit] 📥 query: "${query}"`);
  console.log(
    "[Outfit] 📥 request params:",
    JSON.stringify({ topK, gender, articleType, colour }),
  );

  try {
    const supabase = createSearchClient();

    // ---- Query Understanding Layer ----------------------------------------
    let fallbackReason: string | null = null;

    logSection("[Outfit]", "STEP 1 · PARSE INTENT (rule-based)");
    let intent: QueryIntent = parseQuery(query);
    console.log(
      "[Outfit] parsed intent:",
      JSON.stringify(intent),
      `(confidence ${intent.confidence})`,
    );

    // Gemini parsing is COMPULSORY — escalate every query to the LLM parser and
    // merge over the rule-based intent regardless of confidence. We only skip
    // while the circuit breaker is open (post-429 cooldown), keeping the
    // rule-based intent rather than worsening the rate limit.
    logSection("[Outfit]", "STEP 2 · GEMINI ESCALATION");
    if (isGeminiCircuitOpen()) {
      const secs = Math.ceil(geminiCircuitCooldownRemainingMs() / 1000);
      fallbackReason = `gemini circuit open (~${secs}s left); rule-based intent only`;
      console.log(`[Outfit] ⛔ SKIPPING GEMINI — circuit open (~${secs}s left).`);
    } else {
      console.log(`[Outfit] 🤖 CALLING GEMINI (compulsory) for: "${query}"`);
      try {
        const llmIntent = await parseWithLLMCached(query);
        intent = mergeIntents(intent, llmIntent);
        console.log("[Outfit] ✅ GEMINI merged intent:", JSON.stringify(intent));
      } catch (llmError) {
        fallbackReason = `gemini failed: ${llmError instanceof Error ? llmError.message : String(llmError)}`;
        console.log("[Outfit] ⚠️ GEMINI failed; rule-based intent:", fallbackReason);
      }
    }

    logSection("[Outfit]", "STEP 3 · ONTOLOGY + EXPANSION");
    console.log("[Outfit] final intent:", JSON.stringify(intent));
    console.log("[Outfit] ontology match:", describeOntologyMatch(intent));

    // Expand the intent into concrete catalog terms (always includes the raw
    // query so the term list is non-empty and supersets the single search).
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
      console.warn("[Outfit] expansion failed; using raw query:", fallbackReason);
    }
    console.log("[Outfit] expanded terms:", JSON.stringify(expandedTerms));

    const brandTier = resolveBrandTier(intent?.style);
    const filters = {
      gender: gender ?? mapIntentGender(intent.gender),
      articleType,
      colour,
      brandTier,
    };

    // Multi-search + diversified ranking, then group into an outfit.
    try {
      logSection("[Outfit]", "STEP 4 · QUERY CATALOG (multi-search)");
      console.log(
        `[Outfit] 🔎 querying ${expandedTerms.length} term(s) with filters:`,
        JSON.stringify(filters),
      );
      console.log("[Outfit] 🔎 search terms:", JSON.stringify(expandedTerms));

      const result = await orchestrateRetrieval({
        searchTerms: expandedTerms,
        topK,
        perTermK: Math.max(topK, 4),
        // Keep the top-N per outfit slot (not a flat top-K) so every slot has
        // candidates before the gender/occasion filters run — otherwise one
        // dominant category (e.g. trousers) can leave the tops slot with only
        // tshirts, which the occasion filter then blocks, emptying the slot.
        slotAware: true,
        searchFn: (term, k) => runHybridSearch(supabase, term, k, filters),
      });

      console.log("[Outfit] per-term hits:", JSON.stringify(result.retrievalCounts));
      console.log(
        `[Outfit] merged unique candidates: ${result.mergedCount} → ranked top ${result.products.length}`,
      );
      console.log(
        "[Outfit] candidate composition:",
        JSON.stringify(categoryBreakdown(result.products)),
      );
      logProducts("[Outfit]", "ranked candidates", result.products);

      if (result.products.length > 0) {
        // Infer gender, validate footwear, and apply the occasion filter
        // (global pass) before grouping; group enforces per-slot whitelists.
        logSection("[Outfit]", "STEP 5 · FILTER (gender + footwear + occasion)");
        const { refined, genderFiltered, occasionRule } = refineCandidates(
          result.products,
          intent,
        );
        console.log(
          `[Outfit] gender/footwear filter: ${result.products.length} → ${genderFiltered.length} (dropped ${result.products.length - genderFiltered.length})`,
        );
        if (occasionRule) {
          console.log(
            `[Outfit] occasion filter ("${intent.occasion}") active: ${genderFiltered.length} → ${refined.length} (dropped ${genderFiltered.length - refined.length})`,
          );
        } else {
          console.log(
            `[Outfit] occasion filter inactive (occasion="${intent.occasion ?? "none"}", confidence=${intent.confidence})`,
          );
        }
        logProducts("[Outfit]", "products after filtering", refined);

        logSection("[Outfit]", "STEP 6 · GROUP INTO OUTFIT");
        const outfit = groupOutfit(refined, {
          occasionRule,
          fallbackProducts: genderFiltered,
        });
        console.log(
          "[Outfit] outfit slots:",
          JSON.stringify({
            tops: outfit.tops.length,
            bottoms: outfit.bottoms.length,
            footwear: outfit.footwear.length,
            accessories: outfit.accessories.length,
          }),
        );
        logProducts("[Outfit]", "outfit · tops", outfit.tops);
        logProducts("[Outfit]", "outfit · bottoms", outfit.bottoms);
        logProducts("[Outfit]", "outfit · footwear", outfit.footwear);
        logProducts("[Outfit]", "outfit · accessories", outfit.accessories);

        // The UI-facing product list should never show "other" items (groupOutfit
        // already drops them from the outfit slots).
        const visibleProducts = dropOtherCategory(refined);
        logSection("[Outfit]", "RESPONSE (query-understanding)");
        console.log(
          `[Outfit] ✅ returning ${visibleProducts.length} products in ${Date.now() - startedAt}ms`,
        );
        const response: OutfitResponse = {
          query,
          strategy: "query-understanding",
          intent,
          expanded_terms: expandedTerms,
          fallback_reason: fallbackReason,
          outfit,
          products: visibleProducts,
          total: visibleProducts.length,
        };
        return NextResponse.json(response);
      }

      fallbackReason = "multi-search returned no results; using legacy fallback";
      console.log(`[Outfit] ${fallbackReason}`);
    } catch (qulError) {
      fallbackReason = `multi-search failed (${qulError instanceof Error ? qulError.message : String(qulError)}); using legacy fallback`;
      console.warn("[Outfit] multi-search failed; using legacy fallback:", qulError);
    }

    // ---- Legacy single-search fallback ------------------------------------
    // Still grouped into an outfit so the UI contract is identical.
    logSection("[Outfit]", "LEGACY FALLBACK · single hybrid search");
    console.log(
      `[Outfit] 🔎 single search for "${query}" with filters:`,
      JSON.stringify(filters),
    );
    const products = await runHybridSearch(supabase, query, topK, filters);
    console.log(`[Outfit] legacy search returned ${products.length} products`);
    const { refined, genderFiltered, occasionRule } = refineCandidates(
      products,
      intent,
    );
    console.log(
      `[Outfit] gender/footwear filter: ${products.length} → ${genderFiltered.length}; occasion filter → ${refined.length}`,
    );
    const outfit = refined.length
      ? groupOutfit(refined, { occasionRule, fallbackProducts: genderFiltered })
      : EMPTY_OUTFIT;
    const visibleProducts = dropOtherCategory(refined);
    logProducts("[Outfit]", "legacy products after filtering", refined);
    logSection("[Outfit]", "RESPONSE (legacy)");
    console.log(
      `[Outfit] ✅ returning ${visibleProducts.length} products in ${Date.now() - startedAt}ms (fallback: ${fallbackReason ?? "none"})`,
    );

    const response: OutfitResponse = {
      query,
      strategy: "legacy",
      intent,
      expanded_terms: expandedTerms,
      fallback_reason: fallbackReason,
      outfit,
      products: visibleProducts,
      total: visibleProducts.length,
    };
    return NextResponse.json(response);
  } catch (err: unknown) {
    console.error("Outfit error:", err);
    const message = err instanceof Error ? err.message : "Outfit generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
