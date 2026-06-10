ALTER TABLE products
ADD COLUMN IF NOT EXISTS brand_tier TEXT DEFAULT 'budget';

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding TEXT,
  query_text TEXT,
  match_count INTEGER DEFAULT 12,
  filter_gender TEXT DEFAULT NULL,
  filter_article_type TEXT DEFAULT NULL,
  filter_colour TEXT DEFAULT NULL,
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
    (1 - (p.text_embedding::vector <=> query_embedding::vector))
      AS semantic_score,
    ts_rank(
      to_tsvector('english',
        COALESCE(p.name,'') || ' ' || COALESCE(p.article_type,'')
        || ' ' || COALESCE(p.colour,'')),
      plainto_tsquery('english', query_text)
    ) AS keyword_score,
    (
      0.7 * (1 - (p.text_embedding::vector <=> query_embedding::vector))
      + 0.3 * ts_rank(
        to_tsvector('english',
          COALESCE(p.name,'') || ' ' || COALESCE(p.article_type,'')
          || ' ' || COALESCE(p.colour,'')),
        plainto_tsquery('english', query_text))
    ) AS final_score
  FROM products p
  WHERE
    (filter_gender IS NULL OR p.gender = filter_gender)
    AND (filter_article_type IS NULL OR p.article_type = filter_article_type)
    AND (filter_colour IS NULL OR p.colour = filter_colour)
    AND (filter_brand_tier IS NULL OR p.brand_tier = filter_brand_tier)
    AND p.text_embedding IS NOT NULL
  ORDER BY final_score DESC
  LIMIT match_count;
$$;
