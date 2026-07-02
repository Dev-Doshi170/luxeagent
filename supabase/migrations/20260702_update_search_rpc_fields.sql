-- Drop existing functions before recreation to allow changing their return types
DROP FUNCTION IF EXISTS public.hybrid_search(text,text,integer,text,text,text,text);
DROP FUNCTION IF EXISTS public.visual_search(text,integer,text,text,text);

-- Update hybrid_search to return brand, brand_tier, and embedding_text in addition to original fields
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
  id INTEGER,
  name TEXT,
  gender TEXT,
  article_type TEXT,
  colour TEXT,
  usage_type TEXT,
  image_url TEXT,
  brand TEXT,
  brand_tier TEXT,
  embedding_text TEXT,
  semantic_score DOUBLE PRECISION,
  keyword_score DOUBLE PRECISION,
  final_score DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  WITH semantic_candidates AS (
    SELECT p.id, (1 - (p.text_embedding <=> query_embedding::vector)) AS semantic_score
    FROM products p
    WHERE (filter_gender IS NULL OR p.gender = filter_gender)
      AND (filter_article_type IS NULL OR p.article_type = filter_article_type)
      AND (filter_colour IS NULL OR p.colour = filter_colour)
      AND (filter_brand_tier IS NULL OR p.brand_tier = filter_brand_tier)
      AND p.text_embedding IS NOT NULL
    ORDER BY p.text_embedding <=> query_embedding::vector ASC
    LIMIT GREATEST(match_count * 10, 150)
  ),
  keyword_candidates AS (
    SELECT p.id, ts_rank(
        to_tsvector('english',
          COALESCE(p.name,'') || ' ' || COALESCE(p.article_type,'')
          || ' ' || COALESCE(p.colour,'')),
        plainto_tsquery('english', query_text)
      ) AS keyword_score
    FROM products p
    WHERE (filter_gender IS NULL OR p.gender = filter_gender)
      AND (filter_article_type IS NULL OR p.article_type = filter_article_type)
      AND (filter_colour IS NULL OR p.colour = filter_colour)
      AND (filter_brand_tier IS NULL OR p.brand_tier = filter_brand_tier)
      AND p.text_embedding IS NOT NULL
      AND to_tsvector('english', COALESCE(p.name,'') || ' ' || COALESCE(p.article_type,'') || ' ' || COALESCE(p.colour,'')) @@ plainto_tsquery('english', query_text)
    ORDER BY keyword_score DESC
    LIMIT GREATEST(match_count * 10, 150)
  ),
  candidate_ids AS (
    SELECT id FROM semantic_candidates
    UNION
    SELECT id FROM keyword_candidates
  )
  SELECT
    p.id,
    p.name,
    p.gender,
    p.article_type,
    p.colour,
    p.usage_type,
    p.image_url,
    p.brand,
    p.brand_tier,
    p.embedding_text,
    COALESCE(sc.semantic_score, (1 - (p.text_embedding <=> query_embedding::vector)))::DOUBLE PRECISION AS semantic_score,
    COALESCE(kc.keyword_score, 0.0::DOUBLE PRECISION)::DOUBLE PRECISION AS keyword_score,
    (
      0.7 * COALESCE(sc.semantic_score, (1 - (p.text_embedding <=> query_embedding::vector)))
      + 0.3 * COALESCE(kc.keyword_score, 0.0::DOUBLE PRECISION)
    )::DOUBLE PRECISION AS final_score
  FROM candidate_ids c
  JOIN products p ON p.id = c.id
  LEFT JOIN semantic_candidates sc ON sc.id = c.id
  LEFT JOIN keyword_candidates kc ON kc.id = c.id
  ORDER BY final_score DESC
  LIMIT match_count;
$$;

-- Update visual_search to return brand, brand_tier, and embedding_text in addition to original fields
CREATE OR REPLACE FUNCTION public.visual_search(
  query_embedding TEXT,
  match_count INTEGER DEFAULT 12,
  filter_gender TEXT DEFAULT NULL,
  filter_article_type TEXT DEFAULT NULL,
  filter_brand_tier TEXT DEFAULT NULL
)
RETURNS TABLE(
  id INTEGER,
  name TEXT,
  gender TEXT,
  article_type TEXT,
  colour TEXT,
  usage_type TEXT,
  image_url TEXT,
  brand TEXT,
  brand_tier TEXT,
  embedding_text TEXT,
  semantic_score DOUBLE PRECISION,
  keyword_score DOUBLE PRECISION,
  final_score DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.name,
    p.gender,
    p.article_type,
    p.colour,
    p.usage_type,
    p.image_url,
    p.brand,
    p.brand_tier,
    p.embedding_text,
    (1 - (p.image_embedding <=> query_embedding::vector))::DOUBLE PRECISION AS semantic_score,
    0.0::DOUBLE PRECISION AS keyword_score,
    (1 - (p.image_embedding <=> query_embedding::vector))::DOUBLE PRECISION AS final_score
  FROM products p
  WHERE
    (filter_gender IS NULL OR p.gender = filter_gender)
    AND (filter_article_type IS NULL OR p.article_type = filter_article_type)
    AND (filter_brand_tier IS NULL OR p.brand_tier = filter_brand_tier)
    AND p.image_embedding IS NOT NULL
  ORDER BY p.image_embedding <=> query_embedding::vector ASC
  LIMIT match_count;
$$;
