"use client";

import { useState } from "react";
import { ExperienceShell } from "@/components/ExperienceShell";
import { ProductGrid } from "@/components/ProductGrid";
import { SearchBar, type SearchFilters } from "@/components/SearchBar";
import type { Product } from "@/types/product";

/**
 * Product Search — the "I already know what I want" experience. A search bar +
 * product grid backed by the deterministic `/api/product-search` endpoint
 * (expand -> embed -> hybrid_search). No outfit generation here.
 */
export default function ProductSearchPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch({ query, gender, articleType }: SearchFilters) {
    if (!query) return;

    setIsLoading(true);
    setHasSearched(true);
    setError(null);

    const params = new URLSearchParams({ q: query, top_k: "12" });
    if (gender) params.set("gender", gender);
    if (articleType) params.set("article_type", articleType);

    try {
      const response = await fetch(`/api/product-search?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }

      setProducts(data.products ?? []);
    } catch (searchError) {
      setProducts([]);
      setError(searchError instanceof Error ? searchError.message : "Search failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ExperienceShell
      active="product-search"
      eyebrow="Find the exact piece you have in mind"
      title="Discover your next signature look."
      subtitle="Search the catalog directly by keyword, gender, and category. Fast, focused retrieval for when you already know what you want."
    >
      <section className="space-y-8">
        <SearchBar onSearch={handleSearch} isLoading={isLoading} />

        {error ? (
          <div className="mx-auto max-w-5xl rounded-2xl border border-red-300/20 bg-red-500/10 px-5 py-4 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <div className="rounded-[2.5rem] border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="min-h-[28rem] rounded-[2rem] border border-white/10 bg-[#070A12]/80 p-4 sm:p-6">
            {hasSearched || isLoading ? (
              <ProductGrid products={products} isLoading={isLoading} />
            ) : (
              <div className="flex min-h-[24rem] items-center justify-center rounded-[2rem] border border-dashed border-[#C9A84C]/25 bg-[#C9A84C]/5 px-6 text-center">
                <div className="max-w-md">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#C9A84C]">
                    Search The Atelier
                  </p>
                  <h2 className="mt-4 font-serif text-3xl text-white sm:text-4xl">
                    Start searching to discover your look.
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/55">
                    Try &ldquo;black oversized t-shirt&rdquo;, &ldquo;white
                    sneakers&rdquo;, or &ldquo;blue formal shirt&rdquo;.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </ExperienceShell>
  );
}
