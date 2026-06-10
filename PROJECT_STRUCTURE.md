# LuxeAgent — Project Structure & File Guide

LuxeAgent is an **AI-powered luxury fashion search and concierge app**. Users can either
search a curated fashion catalog directly (**Product Search**) or brief an AI stylist that
assembles a complete look from real catalog items (**Outfit Creator**). The project combines
a Next.js web app, a hybrid search engine (semantic + keyword + visual + brand-prestige
scoring), a frontend **Query Understanding Layer** (intent parsing + LLM fallback + fashion
ontology + multi-search), local data-processing scripts, and an offline retrieval-evaluation
harness.

---

## 1. The Big Picture — Two Implementations, Two Web Experiences

There are **two parallel implementations of the same hybrid search**, which is the single
most important thing to understand:

| Path | Where it runs | Used by | Storage |
|------|---------------|---------|---------|
| **Production path** | Next.js API routes (`frontend/src/app/api/*`) | The live web app | Supabase (pgvector) |
| **Local/offline path** | Python FastAPI + scripts (`backend/`, `app/`, root scripts) | Experimentation, evaluation, catalog prep | Local `.parquet` files |

Both paths share the **same scoring philosophy** (semantic + BM25 + luxury, optionally CLIP)
and the **same deterministic query-expansion and brand-extraction logic**, intentionally kept
in sync so local evaluation reflects production behavior.

- The **web app** (what a user actually hits) creates a MiniLM embedding in the Next.js
  route and calls the Supabase `hybrid_search` SQL function.
- The **Python backend** loads the catalog parquet, builds FAISS + BM25 indexes in memory,
  and runs the same scoring plus an extra cross-encoder reranking step. It is mainly used to
  prototype and to score retrieval quality offline.

### The two web experiences (production)

The live app exposes **two routes** that share one catalog, one Supabase `hybrid_search`
RPC, and one shared search primitive (`lib/hybrid-search.ts`), but differ in sophistication:

| Experience | Route / API | What it does |
|------------|-------------|--------------|
| **Product Search** | `/product-search` → `GET /api/product-search` | Deterministic "I know what I want": expand → embed → single `hybrid_search`. No intent parsing. |
| **Outfit Creator** | `/outfit-creator` → `POST /api/outfit` | "Help me build a look": runs the full **Query Understanding Layer**, then groups results into a complete outfit. |

The homepage (`/`) redirects to `/product-search`. A shared `ExperienceShell` renders the
luxury hero and the `[Product Search] [Outfit Creator]` tab bar.

### The Query Understanding Layer (Outfit Creator)

The Outfit Creator's pipeline (all in `frontend/src/lib/`) turns vague styling language into
a balanced outfit:

1. **Parse intent** (`query-parser.ts`) — rule-based extraction of gender / occasion / season
   / style / budget / colors / brands / nouns, with a 0..1 confidence score.
2. **LLM fallback** (`query-parser.ts`) — when confidence is low, escalate to Google **Gemini**
   for structured intent, protected by a **circuit breaker** (trips on HTTP 429) and an
   in-memory LRU cache. Always degrades gracefully back to rule-based intent.
3. **Expand** (`query-expander.ts` + `fashion-ontology.ts`) — map `occasion × style` to concrete
   catalog terms (e.g. beach wedding + luxury → `linen shirt`, `beige chinos`, `loafers`),
   folding in season modifiers and color hints. Always includes the raw query.
4. **Multi-search + diversify** (`retrieval-orchestrator.ts`) — one `hybrid_search` per term,
   merge + dedupe, then re-rank with `0.70·relevance + 0.30·diversity` so the result is a
   balanced look (top + bottom + footwear + accessory) instead of "12 sandals".
5. **Group** (`outfit-builder.ts`) — bucket the ranked products into `{ tops, bottoms, footwear,
   accessories }` for the UI.

> A **legacy chat** surface (`/api/chat`, `ChatInterface.tsx`, `chatToolPolicy.ts`,
> `messageText.ts`) and the original `GET /api/search` endpoint still exist, but the homepage no
> longer links to chat — the two routes above are the live experiences. `/api/chat` still calls
> `/api/search` internally.

---

## 2. Directory Tree

```text
luxeagent/
├── frontend/                # Next.js 16 web application (the live product)
│   ├── src/
│   │   ├── app/             # App-router pages + API routes
│   │   │   ├── product-search/   # Product Search experience (page)
│   │   │   ├── outfit-creator/   # Outfit Creator experience (page)
│   │   │   └── api/              # product-search, outfit, search, chat routes
│   │   ├── components/      # React UI components (shell, grid, cards, outfit, chat)
│   │   ├── lib/             # Search primitives + Query Understanding Layer
│   │   └── types/           # Shared TypeScript types (Product, Outfit, generated DB types)
│   └── public/              # Static SVG assets
├── backend/                 # Current Python FastAPI hybrid-search backend
├── app/                     # Older/fuller Python search variant (CLIP-enabled)
├── scripts/                 # Catalog rebuild, embeddings, and Supabase upload utilities
├── supabase/migrations/     # SQL for the products table + hybrid_search function
├── tests/                   # Python unit tests for search/eval logic
├── data/                    # Product catalog, embeddings, and image assets
├── notebooks/               # Exploratory data-analysis notebooks
├── evaluation.py            # Offline retrieval-quality evaluation CLI
├── generate_eval_dataset.py # Builds realistic eval queries from the catalog
├── evaluation_queries.csv   # Generated evaluation dataset
├── .venv/                   # Local Python virtual environment (generated)
└── .vscode/                 # Editor settings
```

---

## 3. `frontend/` — Next.js Web Application

The user-facing app. Stack: **Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4,
Supabase, Groq, Google Gemini, and the Vercel AI SDK**. It is organized as two dedicated
routes — **Product Search** and **Outfit Creator** — that share a luxury `ExperienceShell`.

> Note: `frontend/AGENTS.md` warns that this is a newer Next.js with breaking changes — consult
> `node_modules/next/dist/docs/` before editing Next.js-specific code.

### App router & pages (`frontend/src/app/`)

- **`page.tsx`** — The homepage. Simply `redirect()`s to `/product-search` (the default
  experience); the two experiences live at their own routes.
- **`product-search/page.tsx`** — The **Product Search** experience. A `SearchBar` + `ProductGrid`
  backed by `GET /api/product-search`. The "I already know what I want" path; no outfit logic.
- **`outfit-creator/page.tsx`** — The **Outfit Creator** experience. A styling-brief input
  (+ suggested prompts) posts to `POST /api/outfit` and renders the returned look via
  `OutfitResult`. The "help me build a complete look" path.
- **`layout.tsx`** — Root layout: sets up the `Inter` and `Playfair_Display` fonts, page
  metadata (`LuxeAgent | AI Luxury Fashion Concierge`), and the base HTML shell.
- **`globals.css`** — Global Tailwind imports and theme styles.
- **`favicon.ico`** — Site icon.

### API routes (`frontend/src/app/api/`)

- **`product-search/route.ts`** — Product Search endpoint (`GET /api/product-search`). The
  deterministic path: reads `q`, `top_k`, and optional `gender`/`article_type`/`colour`, then
  calls the shared `runHybridSearch` (expand → embed → single `hybrid_search`). **No** intent
  parsing, ontology, multi-search, or diversification.
- **`outfit/route.ts`** — Outfit Creator endpoint (`POST /api/outfit`). Runs the full **Query
  Understanding Layer**: `parseQuery` → optional Gemini escalation (`parseWithLLMCached`,
  guarded by the circuit breaker) → `expandIntent` → `orchestrateRetrieval` (multi-search +
  diversified ranking) → `groupOutfit`. Degrades gracefully: any failure falls back to a single
  `runHybridSearch`, still grouped into an outfit, returning a `strategy` of
  `"query-understanding"` or `"legacy"`.
- **`search/route.ts`** — Legacy production search endpoint (`GET /api/search`). Same
  expand → embed → `hybrid_search` flow; retained because `/api/chat` calls it.
- **`chat/route.ts`** — Legacy chat endpoint (`POST /api/chat`). Streams from Groq
  (`llama-3.1-8b-instant`) via the AI SDK, exposing a `search_products` **tool** (which calls
  `/api/search`). A `prepareStep` policy forces a catalog search on the first step. Not linked
  from the current homepage but still functional.

### Components (`frontend/src/components/`)

- **`ExperienceShell.tsx`** — Shared chrome for both experiences: the luxury hero, brand header,
  footer, and the `[Product Search] [Outfit Creator]` tab bar (tabs are real `next/link` routes;
  the active tab is derived from the path).
- **`SearchBar.tsx`** — Search form with a text input, gender dropdown, and (optional) category
  dropdown; emits a `SearchFilters` object. Configurable placeholder/labels and an optional
  controlled `query` (the Outfit Creator hides the category and drives the input via suggested
  prompts).
- **`ProductGrid.tsx`** — Responsive grid of `ProductCard`s with skeleton loaders and an
  empty-state message. Supports a `compact` layout (used inside outfit slots / chat).
- **`ProductCard.tsx`** — A single product tile: image (inline SVG placeholder fallback on error),
  article type / gender badges, colour, occasion, and a relevance score bar.
- **`OutfitResult.tsx`** — Renders a complete `Outfit` as labeled category sections
  (Tops / Bottoms / Footwear / Accessories), each a compact `ProductGrid`; skips empty slots and
  shows a skeleton/empty state.
- **`ChatInterface.tsx`** — *(legacy)* The chat UI built on `@ai-sdk/react`'s `useChat`. Renders
  message parts, a tool-call loading state, and inline product results. No longer mounted by any
  page but kept alongside the chat route.

### Frontend libraries (`frontend/src/lib/`)

**Shared search primitive:**

- **`hybrid-search.ts`** — The single home for production search primitives shared by every
  surface: the cached in-process MiniLM embedder (`getEmbedding`), the Supabase service-client
  factory (`createSearchClient`), the `runHybridSearch` RPC call (expand → embed → search), and
  the `mapIntentGender` helper. Both Product Search and the Outfit Creator orchestrator inject
  `runHybridSearch`, so catalog retrieval is implemented exactly once.

**Query Understanding Layer (Outfit Creator):**

- **`query-parser.ts`** — Rule-based intent extraction (`parseQuery`) into a structured
  `QueryIntent` with a confidence score, plus the **Gemini** LLM fallback (`parseWithLLM` /
  cached `parseWithLLMCached`) with retries, an in-memory LRU cache, and a **circuit breaker**
  that trips on HTTP 429 to protect the free-tier quota. Also exposes `mergeIntents`,
  `extractBudget`, and the canonical vocabularies the LLM must emit.
- **`fashion-ontology.ts`** — *Data only.* Maps `occasion × style` to concrete catalog terms
  (`FASHION_ONTOLOGY`) plus `SEASON_MODIFIERS`. Bridges styling language and product attributes.
- **`query-expander.ts`** — `expandIntent` turns a `QueryIntent` into a bounded, de-duplicated
  list of catalog search terms via the ontology (with color/season hints), always including the
  raw query so the multi-search is a strict superset of the single search.
- **`retrieval-orchestrator.ts`** — `orchestrateRetrieval` runs one injected search per term,
  merges + dedupes by id, classifies items into outfit buckets, and re-ranks with
  `0.70·relevance + 0.30·diversity` (quadratic falloff per category) to avoid "12 sandals".
- **`outfit-builder.ts`** — `groupOutfit` buckets ranked products into the `Outfit` shape
  (`{ tops, bottoms, footwear, accessories }`), capping items per slot and dropping "other".

**Other helpers:**

- **`supabase.ts`** — Creates the Supabase client (anon client + a service-role admin factory).
- **`queryExpansion.ts`** — Deterministic fashion synonym expansion + tokenizer. **Mirrors the
  Python `backend/query_expansion.py`** so production and offline search expand queries
  identically. Used by `runHybridSearch`.
- **`chatToolPolicy.ts`** *(legacy chat)* — Per-step tool policy: step 0 forces the
  `search_products` tool; later steps disable tools.
- **`messageText.ts`** *(legacy chat)* — `shouldRenderAssistantText` guards against the model
  leaking raw serialized product payloads after product cards render.
- **`productGridLayout.ts`** — Returns the Tailwind grid class names for normal vs `compact`
  grids.

### Types (`frontend/src/types/`)

- **`product.ts`** — The shared `Product` type used across search, outfit, chat, and UI.
- **`outfit.ts`** — The `Outfit` composition type, `OutfitSlot`/labels, the `OutfitResponse` API
  contract, and the `EMPTY_OUTFIT` default.
- **`database.types.ts`** — Auto-generated Supabase schema types for the `products` table and
  the `hybrid_search` function (regenerate with the `supabase:types` npm script).

### Frontend config & meta files

- **`package.json`** — Scripts (`dev`, `build`, `start`, `test`, `lint`, `supabase:types`) and
  dependencies (Next 16, React 19, Supabase, `@xenova/transformers`, the AI SDK + `@ai-sdk/groq`,
  `zod`). Tests run via Node's built-in test runner (with `--experimental-strip-types`) against
  `src/**/*.test.mjs`.
- **`next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`,
  `next-env.d.ts`** — Next.js, TypeScript, ESLint, and PostCSS/Tailwind configuration.
- **`AGENTS.md` / `CLAUDE.md`** — Local guidance for AI agents working in this folder.
- **`README.md`** — Standard Next.js readme.
- **`public/*.svg`** — Default Next.js static assets.

### Frontend test files (`*.test.mjs`)

- `components/ProductGrid.test.mjs` — Verifies the compact grid wraps without horizontal scroll.
- `lib/queryUnderstanding.test.mjs` — End-to-end Query Understanding Layer: intent parsing,
  budget extraction, intent merging, ontology expansion, the Gemini circuit breaker, and the
  multi-search orchestrator (`classifyArticleType` / `orchestrateRetrieval`).
- `lib/outfitBuilder.test.mjs` — Verifies `groupOutfit` bucketing, per-slot caps, and
  `isOutfitEmpty`.
- `lib/queryExpansion.test.mjs` — Verifies fashion synonym expansion.
- `lib/chatToolPolicy.test.mjs` *(legacy chat)* — Verifies the per-step tool policy.
- `lib/messageText.test.mjs` *(legacy chat)* — Verifies raw product payloads are suppressed.

---

## 4. `backend/` — Current Python FastAPI Search Backend

The actively-used Python search service. Loads the catalog parquet, builds in-memory indexes,
and serves a hybrid-search API with cross-encoder reranking.

- **`api.py`** — FastAPI app with CORS enabled. Endpoints:
  - `GET /health` — status + catalog size.
  - `GET /search?q=…&top_k=…&gender=…&article_type=…&colour=…` — runs hybrid search.
  - `GET /product/{id}` — full metadata for one product.
  - `GET /catalog/meta` — distinct article types, brands, genders, colours, categories (for
    building filter UIs).
- **`search.py`** — The core hybrid search engine. On import it loads the catalog, precomputes
  luxury scores, and builds a **MiniLM FAISS index**, an optional **CLIP FAISS index**, and a
  **BM25 index**. The `search()` function: expands the query → scores via semantic + BM25 +
  luxury (+ CLIP when enabled) → normalizes → combines with weights → takes top candidates →
  **cross-encoder reranks** → returns a ranked DataFrame. CLIP is lazy-loaded and disabled by
  default (`LUXE_ENABLE_CLIP=1` to enable) to avoid a Python 3.13 / PyTorch MPS segfault.
- **`scoring.py`** — Central scoring weights. `TEXT_WEIGHTS` (0.60 semantic / 0.25 BM25 / 0.15
  luxury) and `MULTIMODAL_WEIGHTS` (0.50 / 0.20 clip / 0.20 / 0.10 luxury) plus the
  `combine_scores()` helper. Keeping weights here keeps Python and SQL paths aligned.
- **`query_expansion.py`** — Deterministic fashion synonym dictionary + `tokenize()` /
  `expand_query()`. The Python source of truth that `frontend/src/lib/queryExpansion.ts` mirrors.
- **`reranker.py`** — Cross-encoder reranker (`cross-encoder/ms-marco-MiniLM-L-6-v2`, CPU,
  lazy-loaded). Re-scores the top hybrid candidates by reading the **query and product text
  together**, giving much sharper relevance than the first-stage scores.

---

## 5. `app/` — Older / Fuller Python Search Variant

An alternate, earlier implementation that overlaps heavily with `backend/` but wires CLIP in
more eagerly (loads the CLIP model at import time rather than lazily). It reuses
`backend/`'s `query_expansion`, `scoring`, and `reranker` modules.

- **`api.py`** — Near-identical FastAPI surface to `backend/api.py` (without the `brand` field
  in some responses).
- **`search.py`** — Same hybrid pipeline as `backend/search.py`, but loads CLIP at startup when
  enabled. Treat `backend/` as the canonical version; `app/` is kept for reference/comparison.

---

## 6. `scripts/` — Data Preparation & Upload

- **`catalog_text.py`** — Shared text helpers used everywhere catalog text is generated:
  `extract_brand()` (conservative brand-prefix detection against a known-brand list) and
  `build_embedding_text()` (turns a product row into a rich natural-language description for
  embeddings). Keeps the parquet, Supabase upload, and evaluation describing products identically.
- **`rebuild_catalog.py`** — Rebuilds a **balanced** catalog from raw `styles.csv` + `images.csv`:
  filters to target categories, keeps only rows whose image exists on disk, adds brand +
  embedding text, generates MiniLM embeddings, and writes `balanced_catalog.parquet` and
  `balanced_catalog_with_embeddings.parquet`.
- **`generate_clip_embeddings.py`** — Adds 512-dim **CLIP (ViT-B-32) image embeddings** for each
  product image into the catalog parquet (uses MPS/GPU when available, zero-vector fallback for
  missing images).
- **`upload_to_supabase.py`** — Uploads the catalog (metadata + text & CLIP embeddings) into the
  Supabase `products` table in batches via upsert, then verifies the row count.

---

## 7. `supabase/migrations/`

- **`20260604_add_brand_and_update_hybrid_search.sql`** — Enables the `vector` extension, adds a
  `brand` column to `products`, and defines the **`hybrid_search` SQL function**. This is the
  production scoring engine: it computes normalized semantic (pgvector cosine), keyword
  (tsvector token matching), and luxury (regex brand tiers) scores and combines them with the
  same `0.60 / 0.25 / 0.15` weights as the Python text path. Apply it in Supabase after
  uploading a catalog that includes `products.brand`.

---

## 8. Offline Evaluation (repo root)

- **`generate_eval_dataset.py`** — Builds a realistic single-product evaluation set: samples
  products stratified across categories and synthesizes natural-language queries from each
  product's attributes (brand/colour/usage/article/gender). Each query maps to exactly one
  relevant product ID. Writes `evaluation_queries.csv`.
- **`evaluation.py`** — Offline retrieval-quality CLI. Loads `query,relevant_ids` judgments,
  runs them through `backend/search.py`, and reports **Recall@10**, **Recall@20**, and **MRR**.
  Metric helpers are import-light so they're fast and testable without loading models.
- **`evaluation_queries.csv`** — The generated evaluation dataset consumed by `evaluation.py`.

---

## 9. `tests/` — Python Unit Tests

- **`test_catalog_text.py`** — Brand extraction and embedding-text generation.
- **`test_query_expansion.py`** — Fashion synonym expansion + tokenization.
- **`test_scoring.py`** — Score-combination weights (text vs multimodal).
- **`test_evaluation.py`** — `parse_relevant_ids`, recall, and MRR calculations.
- **`test_generate_eval_dataset.py`** — Eval-row generation + CSV round-trip.
- **`test_search_clip_loading.py`** — CLIP lazy-loading behavior in `search.py` (mocked).

---

## 10. `data/` — Catalog & Search Assets

- **`styles.csv`** — Raw product metadata (the original dataset).
- **`images.csv`** — Maps product image filenames to image links.
- **`product_images/`** — Local product image files (`{id}.jpg`).
- **`balanced_catalog_with_embeddings.parquet`** — The **main generated catalog** used by the
  Python search backend and the Supabase upload (includes MiniLM + CLIP embeddings).
- **`balanced_catalog.parquet`** — Balanced catalog metadata without embeddings.
- Other generated artifacts (`catalog_with_embeddings.parquet/.pkl`, `image_embeddings.pkl`,
  `premium_catalog.parquet`, `premium_multimodal_catalog.parquet`) — older/intermediate search
  assets retained from earlier iterations.

---

## 11. `notebooks/`

- **`01_explore_data.ipynb`** — Exploratory analysis of the catalog data.

---

## 12. Generated, Local & Environment Files

These are required to run locally but are **not core source**:

- `frontend/.next/`, `frontend/node_modules/` — Next.js build output and dependencies.
- `.venv/` — Python virtual environment.
- `__pycache__/` — Python bytecode caches.
- `.env` (Python: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) and
  `frontend/.env.local` (Next.js: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GROQ_API_KEY`, `NEXT_PUBLIC_APP_URL`, plus the Outfit
  Creator's `GEMINI_API_KEY` and optional `GEMINI_MODEL` / `GEMINI_MAX_ATTEMPTS` /
  `GEMINI_CIRCUIT_COOLDOWN_MS`) — secrets/config.
- `.vscode/settings.json` — Editor settings.

---

## 13. End-to-End Flows

### Data preparation (offline, run once / when catalog changes)
1. Raw data starts in `data/styles.csv` + `data/images.csv`.
2. `scripts/rebuild_catalog.py` builds a balanced catalog with MiniLM text embeddings.
3. `scripts/generate_clip_embeddings.py` adds CLIP image embeddings.
4. `scripts/upload_to_supabase.py` pushes everything to Supabase.
5. The SQL migration installs the `hybrid_search` function used in production.

### Production request flow (the live web app)
1. `/` redirects to `/product-search`; users switch between the two experiences via the
   `ExperienceShell` tab bar.
2. **Product Search:** `/api/product-search` runs `runHybridSearch` (expand → embed with MiniLM
   in-process → Supabase `hybrid_search` RPC) → results render in `ProductGrid`.
3. **Outfit Creator:** `/api/outfit` runs the Query Understanding Layer — `parseQuery` (→ optional
   Gemini) → `expandIntent` → `orchestrateRetrieval` (one `hybrid_search` per term + diversified
   ranking) → `groupOutfit` → `OutfitResult` renders the look. Any failure falls back to a single
   `runHybridSearch`, still grouped into an outfit.
4. **Legacy chat:** `/api/chat` streams from Groq; the model calls the `search_products` tool
   (which hits `/api/search`) and `ChatInterface` renders products as cards. Not linked from the
   current homepage.

### Offline experimentation & evaluation (the Python path)
1. `backend/search.py` builds FAISS + BM25 indexes from the parquet and adds cross-encoder
   reranking.
2. `backend/api.py` can serve this directly for testing.
3. `generate_eval_dataset.py` → `evaluation.py` measure Recall@10/Recall@20/MRR to track quality
