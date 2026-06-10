export type Product = {
  id: number;
  name: string;
  brand: string | null;
  brand_tier?: string | null;
  gender: string;
  article_type: string;
  colour: string;
  usage_type: string;
  image_url: string;
  semantic_score: number;
  keyword_score: number;
  luxury_score?: number;
  final_score: number;
};
