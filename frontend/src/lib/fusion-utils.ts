import type { Product } from "../types/product";
import { FUSION_CONFIG } from "./search-config";

/**
 * Fuse visual search and text search results.
 * Normalizes both score sets to [0, 1] range and combines them using configurable weights.
 */
export function fuseSearchResults(
  imageProducts: Product[],
  textProducts: Product[],
  imageWeight: number = FUSION_CONFIG.IMAGE_WEIGHT,
  textWeight: number = FUSION_CONFIG.TEXT_WEIGHT,
): Product[] {
  const productMap = new Map<number, Product>();
  
  // Maps to store raw scores
  const imageScores = new Map<number, number>();
  const textScores = new Map<number, number>();
  
  for (const p of imageProducts) {
    productMap.set(p.id, p);
    imageScores.set(p.id, p.final_score ?? 0);
  }
  for (const p of textProducts) {
    productMap.set(p.id, p);
    textScores.set(p.id, p.final_score ?? 0);
  }
  
  const allIds = Array.from(productMap.keys());
  if (allIds.length === 0) return [];
  
  // Helper to normalize a map of scores to [0, 1] range
  const normalizeMap = (scoreMap: Map<number, number>, allKeys: number[]): Map<number, number> => {
    const normalized = new Map<number, number>();
    const scores = allKeys.map(k => scoreMap.get(k) ?? 0);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min;
    
    for (const k of allKeys) {
      const val = scoreMap.get(k) ?? 0;
      normalized.set(k, range === 0 ? 1.0 : (val - min) / range);
    }
    return normalized;
  };
  
  const normImage = normalizeMap(imageScores, allIds);
  const normText = normalizeMap(textScores, allIds);
  
  const fusedProducts: Product[] = [];
  for (const id of allIds) {
    const product = productMap.get(id)!;
    const imgScore = normImage.get(id) ?? 0.0;
    const txtScore = normText.get(id) ?? 0.0;
    
    const blendedScore = (imageWeight * imgScore) + (textWeight * txtScore);
    
    fusedProducts.push({
      ...product,
      semantic_score: imgScore, // Store normalized visual score in semantic_score field
      keyword_score: txtScore,   // Store normalized text score in keyword_score field
      final_score: blendedScore,
    });
  }
  
  // Sort descending by blended score
  return fusedProducts.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
}
