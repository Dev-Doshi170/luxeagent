import { NextRequest, NextResponse } from "next/server";
import { createSearchClient, getClipEmbedding, mapIntentGender, runHybridSearch } from "@/lib/hybrid-search";
import { fuseSearchResults } from "@/lib/fusion-utils";
import { rankAndDiversify } from "@/lib/retrieval-orchestrator";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    const textQuery = formData.get("query") as string | null;
    const gender = formData.get("gender") as string | null;
    const articleType = formData.get("article_type") as string | null;
    const brandTier = formData.get("brand_tier") as string | null;
    const topK = parseInt((formData.get("top_k") as string) || "12");

    if (!imageFile) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }

    const supabase = createSearchClient();
    const filters = {
      gender: gender ? mapIntentGender(gender) : null,
      articleType,
      colour: null,
      brandTier,
    };

    // 1. Get embedding for the image
    let imageEmbedding: number[];
    try {
      const bytes = await imageFile.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const base64Image = `data:${imageFile.type};base64,${buffer.toString("base64")}`;
      imageEmbedding = await getClipEmbedding(base64Image);
    } catch (err) {
      console.error("[Visual Search Failsafe] CLIP embedding service failed/unavailable:", err);
      
      // Degrade gracefully: fall back to text-only search if query text is present
      if (textQuery) {
        console.log("[Visual Search Failsafe] Degrading to text-only hybrid search.");
        const textResults = await runHybridSearch(supabase, textQuery, topK, filters);
        return NextResponse.json({
          products: textResults,
          strategy: "fallback-text-only",
          error: err instanceof Error ? err.message : String(err),
        });
      } else {
        return NextResponse.json(
          { error: "Image embedding service unavailable and no text query provided for fallback" },
          { status: 503 }
        );
      }
    }

    // 2. Call visual_search RPC via Supabase
    // Pull more candidates than topK (e.g. max(topK, 50)) to allow proper fusion/diversity filtering
    const fetchK = Math.max(topK, 50);
    const { data: vsData, error: vsError } = await supabase.rpc("visual_search", {
      query_embedding: `[${imageEmbedding.join(",")}]`,
      match_count: fetchK,
      filter_gender: filters.gender ?? undefined,
      filter_article_type: filters.articleType ?? undefined,
      filter_brand_tier: filters.brandTier ?? undefined,
    });

    if (vsError) {
      console.error("[Visual Search] Supabase visual_search RPC failed:", vsError);
      throw vsError;
    }

    const visualResults = (vsData || []).map((p: any) => ({
      ...p,
      brand: p.brand || null,
      brand_tier: p.brand_tier || null,
    }));

    // 3. If text query is present, do hybrid search and fuse
    let finalResults = visualResults;
    let strategy = "visual-only";

    if (textQuery) {
      const textResults = await runHybridSearch(supabase, textQuery, fetchK, filters);
      finalResults = fuseSearchResults(visualResults, textResults);
      strategy = "fused-multimodal";
    }

    // 4. Feed results through deduplication, classification, and diversity-boosting logic
    const diversified = rankAndDiversify(finalResults, topK, false);

    return NextResponse.json({
      products: diversified,
      strategy,
      total: diversified.length,
    });

  } catch (err: any) {
    console.error("Visual search error:", err);
    return NextResponse.json(
      { error: err.message || "Visual search failed" },
      { status: 500 }
    );
  }
}
