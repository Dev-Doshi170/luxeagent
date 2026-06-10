"""
api.py
======
FastAPI server for LuxeAgent search.

Endpoints:
    GET /health
    GET /search?q=navy+mens+shirt&top_k=10
    GET /search?q=blue+jeans&gender=Men&top_k=10
    GET /product/{id}

Run:
    uvicorn api:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import pandas as pd

from search import search as run_search, catalog_df

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="LuxeAgent Search API",
    description="AI-powered fashion search engine",
    version="1.0.0",
)

# ── CORS — allows your React app to call this API ─────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten this to your React dev URL in production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "catalog_size": len(catalog_df),
    }


# ── Search endpoint ───────────────────────────────────────────────────────────
@app.get("/search")
def search_products(
    q: str = Query(..., description="Search query, e.g. 'navy mens shirt'"),
    top_k: int = Query(10, ge=1, le=50, description="Number of results"),
    gender: Optional[str] = Query(None, description="Filter by gender: Men or Women"),
    article_type: Optional[str] = Query(None, description="Filter by type: Shirts, Jeans, etc."),
    colour: Optional[str] = Query(None, description="Filter by colour: Blue, Black, etc."),
):
    # Build filters dict from query params
    filters = {}
    if gender:
        filters["gender"] = gender
    if article_type:
        filters["articleType"] = article_type
    if colour:
        filters["baseColour"] = colour

    results_df = run_search(
        query=q,
        top_k=top_k,
        filters=filters if filters else None,
    )

    # Convert to list of dicts for JSON response
    products = []
    for _, row in results_df.iterrows():
        products.append({
            "id": int(row["id"]),
            "name": row["productDisplayName"],
            "gender": row["gender"],
            "articleType": row["articleType"],
            "colour": row["baseColour"],
            "usage": row["usage"],
            "imageUrl": row["link"],
            "scores": {
                "final": round(float(row["final_score"]), 4),
                "semantic": round(float(row["semantic_score"]), 4),
                "bm25": round(float(row["bm25_score"]), 4),
                "luxury": round(float(row["luxury_score"]), 4),
            },
        })

    return {
        "query": q,
        "filters": filters,
        "total": len(products),
        "products": products,
    }


# ── Single product endpoint ───────────────────────────────────────────────────
@app.get("/product/{product_id}")
def get_product(product_id: int):
    row = catalog_df[catalog_df["id"] == product_id]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")

    row = row.iloc[0]
    return {
        "id": int(row["id"]),
        "name": row["productDisplayName"],
        "gender": row["gender"],
        "masterCategory": row["masterCategory"],
        "subCategory": row["subCategory"],
        "articleType": row["articleType"],
        "colour": row["baseColour"],
        "season": row["season"],
        "usage": row["usage"],
        "imageUrl": row["link"],
    }


# ── Catalog metadata endpoint (useful for building filter UI in React) ────────
@app.get("/catalog/meta")
def catalog_meta():
    return {
        "total_products": len(catalog_df),
        "article_types": sorted(catalog_df["articleType"].dropna().unique().tolist()),
        "genders": sorted(catalog_df["gender"].dropna().unique().tolist()),
        "colours": sorted(catalog_df["baseColour"].dropna().unique().tolist()),
        "categories": sorted(catalog_df["masterCategory"].dropna().unique().tolist()),
    }