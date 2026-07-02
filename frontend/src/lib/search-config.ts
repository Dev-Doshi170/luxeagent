/**
 * Search Fusion Configuration
 * ---------------------------
 * Defines the weights for blending image search results (visual) and
 * text search results (hybrid search).
 */
export const FUSION_CONFIG = {
  // Blended final_score = (IMAGE_WEIGHT * image_score) + (TEXT_WEIGHT * text_score)
  IMAGE_WEIGHT: 0.6,
  TEXT_WEIGHT: 0.4,
};
