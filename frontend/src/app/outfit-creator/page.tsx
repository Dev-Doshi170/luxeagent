"use client";

import { useState } from "react";
import { ExperienceShell } from "@/components/ExperienceShell";
import { OutfitResult } from "@/components/OutfitResult";
import { SearchBar, type SearchFilters } from "@/components/SearchBar";
import type { Outfit, OutfitResponse } from "@/types/outfit";

const suggestedPrompts = [
  "Luxury summer outfit for a beach wedding in Goa",
  "Old money office look",
  "Date night outfit under ₹10,000",
  "Trendy rainy season outfit",
  "Smart casual startup founder look",
];

/**
 * Outfit Creator — the "help me build a complete look" experience. A single
 * styling brief is sent to `/api/outfit`, which runs the Query Understanding
 * pipeline (intent -> ontology -> multi-search -> diversified ranking) and
 * returns a complete outfit grouped by category, rendered by {@link OutfitResult}.
 */
export default function OutfitCreatorPage() {
  const [input, setInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateOutfit(rawQuery: string, gender = "") {
    const query = rawQuery.trim();
    if (!query || isLoading) return;

    setIsLoading(true);
    setHasGenerated(true);
    setSubmittedQuery(query);
    setError(null);

    try {
      const response = await fetch("/api/outfit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, gender: gender || null }),
      });
      const data = (await response.json()) as OutfitResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Outfit generation failed");
      }

      setOutfit(data.outfit ?? null);
    } catch (outfitError) {
      setOutfit(null);
      setError(
        outfitError instanceof Error ? outfitError.message : "Outfit generation failed",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSearch({ query, gender }: SearchFilters) {
    await generateOutfit(query, gender);
  }

  return (
    <ExperienceShell
      active="outfit-creator"
      eyebrow="Brief LuxeAgent like a personal stylist"
      title="Compose a complete look."
      subtitle="Describe the occasion, season, vibe, or budget. LuxeAgent assembles a full outfit — tops, bottoms, footwear, and accessories — from the catalog."
    >
      <section className="space-y-8">
        <SearchBar
          onSearch={handleSearch}
          isLoading={isLoading}
          showCategory={false}
          placeholder="e.g. Luxury summer outfit for a beach wedding in Goa"
          submitLabel="Create Outfit"
          loadingLabel="Composing"
          query={input}
          onQueryChange={setInput}
        />

        <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-2.5">
          {suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                setInput(prompt);
                void generateOutfit(prompt);
              }}
              disabled={isLoading}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/75 transition hover:border-[#C9A84C]/50 hover:bg-[#C9A84C]/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mx-auto max-w-5xl rounded-2xl border border-red-300/20 bg-red-500/10 px-5 py-4 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <div className="rounded-[2.5rem] border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="min-h-[28rem] rounded-[2rem] border border-white/10 bg-[#070A12]/80 p-4 sm:p-6">
            {hasGenerated || isLoading ? (
              <OutfitResult
                outfit={outfit}
                isLoading={isLoading}
                query={submittedQuery}
              />
            ) : (
              <div className="flex min-h-[24rem] items-center justify-center rounded-[2rem] border border-dashed border-[#C9A84C]/25 bg-[#C9A84C]/5 px-6 text-center">
                <div className="max-w-md">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#C9A84C]">
                    Begin With A Brief
                  </p>
                  <h2 className="mt-4 font-serif text-3xl text-white sm:text-4xl">
                    Tell me the occasion. I&apos;ll compose the look.
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/55">
                    Describe an occasion, season, style, or budget and get a
                    complete outfit in seconds.
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
