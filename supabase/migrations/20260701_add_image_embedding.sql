-- Switch the catalog image embeddings column and add an HNSW index on it
-- for fast cosine-similarity visual searches.

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_embedding vector(512);

-- Create HNSW index using vector_cosine_ops
CREATE INDEX IF NOT EXISTS products_image_embedding_hnsw_idx 
ON products USING hnsw (image_embedding vector_cosine_ops);

-- Create visual_search RPC function that accepts optional filters
CREATE OR REPLACE FUNCTION public.visual_search(
  query_embedding TEXT,
  match_count INTEGER DEFAULT 12,
  filter_gender TEXT DEFAULT NULL,
  filter_article_type TEXT DEFAULT NULL,
  filter_brand_tier TEXT DEFAULT NULL
)
RETURNS TABLE(
  id INTEGER, name TEXT, gender TEXT, article_type TEXT,
  colour TEXT, usage_type TEXT, image_url TEXT,
  semantic_score DOUBLE PRECISION,
  keyword_score DOUBLE PRECISION,
  final_score DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id, p.name, p.gender, p.article_type, p.colour,
    p.usage_type, p.image_url,
    (1 - (p.image_embedding <=> query_embedding::vector)) AS semantic_score,
    0.0::DOUBLE PRECISION AS keyword_score,
    (1 - (p.image_embedding <=> query_embedding::vector)) AS final_score
  FROM products p
  WHERE
    (filter_gender IS NULL OR p.gender = filter_gender)
    AND (filter_article_type IS NULL OR p.article_type = filter_article_type)
    AND (filter_brand_tier IS NULL OR p.brand_tier = filter_brand_tier)
    AND p.image_embedding IS NOT NULL
  ORDER BY final_score DESC
  LIMIT match_count;
$$;
