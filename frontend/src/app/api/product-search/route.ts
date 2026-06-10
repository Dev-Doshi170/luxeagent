import { NextRequest, NextResponse } from "next/server";
import {
  createSearchClient,
  runHybridSearch,
} from "@/lib/hybrid-search";
import { logSection, logProducts } from "@/lib/search-logger";

/**
 * Product Search endpoint (`GET /api/product-search`)
 * ---------------------------------------------------
 * The deterministic "I already know what I want" path. It expands the query,
 * embeds it with MiniLM, and runs a single Supabase `hybrid_search`. There is
 * intentionally NO intent parsing, fashion ontology, multi-search, or outfit
 * diversification here — that lives in `/api/outfit` (the Outfit Creator).
 *
 * Query params: `q` (required), `top_k`, `gender`, `article_type`, `colour`.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const topK = parseInt(searchParams.get("top_k") || "12");
  const gender = searchParams.get("gender") || null;
  const articleType = searchParams.get("article_type") || null;
  const colour = searchParams.get("colour") || null;

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter q" }, { status: 400 });
  }

  const startedAt = Date.now();
  logSection("[ProductSearch]", "REQUEST RECEIVED");
  console.log(`[ProductSearch] 📥 query: "${query}"`);
  console.log(
    "[ProductSearch] 📥 request params:",
    JSON.stringify({ topK, gender, articleType, colour }),
  );

  try {
    const supabase = createSearchClient();
    const filters = { gender, articleType, colour, brandTier: null };
    logSection("[ProductSearch]", "QUERY CATALOG (single hybrid search)");
    console.log(
      `[ProductSearch] 🔎 searching "${query}" with filters:`,
      JSON.stringify(filters),
    );
    const products = await runHybridSearch(supabase, query, topK, filters);

    logSection("[ProductSearch]", "RESPONSE");
    console.log(
      `[ProductSearch] ✅ returning ${products.length} products in ${Date.now() - startedAt}ms`,
    );
    logProducts("[ProductSearch]", "results", products);

    return NextResponse.json({
      query,
      strategy: "product-search",
      total: products.length,
      products,
    });
  } catch (err: unknown) {
    console.error("Product search error:", err);
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
