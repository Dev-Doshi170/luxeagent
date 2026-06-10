-- Switch the catalog text embeddings from MiniLM (384-dim) to Voyage
-- `voyage-3-lite` (512-dim).
--
-- IMPORTANT: query and document vectors must come from the SAME model, so the
-- existing 384-dim MiniLM vectors are invalidated by this change. We null them
-- out here and repopulate with Voyage vectors via scripts/reembed_voyage.py.
-- Until that script finishes, semantic search returns no/empty similarity
-- (hybrid_search filters `text_embedding IS NOT NULL`), so run the re-embed
-- immediately after applying this migration.

-- Any approximate-vector index is tied to the old dimension; drop it. (The
-- current hybrid_search casts to ::vector and uses an exact `<=>` scan, so no
-- index is required for correctness.)
DROP INDEX IF EXISTS products_text_embedding_idx;

-- Widen the column to 512 dims, discarding the now-incompatible MiniLM data.
ALTER TABLE products
  ALTER COLUMN text_embedding TYPE vector(512) USING NULL;

-- hybrid_search itself is dimension-agnostic (it casts `p.text_embedding::vector`
-- and the incoming `query_embedding::vector`), so no function change is needed:
-- once both sides are 512-dim Voyage vectors the cosine distance is meaningful.
