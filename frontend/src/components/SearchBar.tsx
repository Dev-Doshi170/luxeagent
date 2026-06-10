"use client";

import { FormEvent, useState } from "react";

export type SearchFilters = {
  query: string;
  gender: string;
  articleType: string;
};

type SearchBarProps = {
  onSearch: (filters: SearchFilters) => void;
  isLoading?: boolean;
  /** Show the category dropdown. Outfit Creator hides it (it builds a full look). */
  showCategory?: boolean;
  /** Input placeholder text. */
  placeholder?: string;
  /** Submit button label when idle. */
  submitLabel?: string;
  /** Submit button label while loading. */
  loadingLabel?: string;
  /** Optional controlled query value (lets a parent drive the input, e.g. suggested prompts). */
  query?: string;
  /** Called when the query changes; required for the controlled `query` prop. */
  onQueryChange?: (value: string) => void;
};

const genders = ["Men", "Women"];
const categories = [
  "Shirts",
  "Dresses",
  "Jeans",
  "Tshirts",
  "Tops",
  "Trousers",
  "Jackets",
  "Shoes",
  "Heels",
  "Handbags",
  "Watches",
];

export function SearchBar({
  onSearch,
  isLoading = false,
  showCategory = true,
  placeholder = "Search for shirts, dresses, watches...",
  submitLabel = "Search",
  loadingLabel = "Searching",
  query: controlledQuery,
  onQueryChange,
}: SearchBarProps) {
  const [internalQuery, setInternalQuery] = useState("");
  const query = controlledQuery ?? internalQuery;
  const setQuery = (value: string) => {
    if (onQueryChange) onQueryChange(value);
    else setInternalQuery(value);
  };
  const [gender, setGender] = useState("");
  const [articleType, setArticleType] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch({ query: query.trim(), gender, articleType: showCategory ? articleType : "" });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-5xl rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-black/30 backdrop-blur-xl"
    >
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[#C9A84C]">
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-4.35-4.35m1.1-5.4a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
              />
            </svg>
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            className="h-14 w-full rounded-full border border-white/10 bg-[#070A12]/80 pl-13 pr-5 text-base text-white outline-none transition placeholder:text-white/55 focus:border-[#C9A84C]/70 focus:ring-4 focus:ring-[#C9A84C]/10"
          />
        </div>

        <div className={`grid gap-3 lg:flex ${showCategory ? "grid-cols-2" : "grid-cols-1"}`}>
          <select
            value={gender}
            onChange={(event) => setGender(event.target.value)}
            className="h-14 rounded-full border border-white/10 bg-[#070A12]/80 px-5 text-sm font-medium text-white outline-none transition focus:border-[#C9A84C]/70 focus:ring-4 focus:ring-[#C9A84C]/10"
            aria-label="Filter by gender"
          >
            <option value="" className="bg-[#070A12] text-white">
              All genders
            </option>
            {genders.map((item) => (
              <option key={item} value={item} className="bg-[#070A12] text-white">
                {item}
              </option>
            ))}
          </select>

          {showCategory ? (
            <select
              value={articleType}
              onChange={(event) => setArticleType(event.target.value)}
              className="h-14 rounded-full border border-white/10 bg-[#070A12]/80 px-5 text-sm font-medium text-white outline-none transition focus:border-[#C9A84C]/70 focus:ring-4 focus:ring-[#C9A84C]/10"
              aria-label="Filter by category"
            >
              <option value="" className="bg-[#070A12] text-white">
                All categories
              </option>
              {categories.map((item) => (
                <option key={item} value={item} className="bg-[#070A12] text-white">
                  {item}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="h-14 rounded-full bg-[#C9A84C] px-8 text-sm font-bold uppercase tracking-[0.24em] text-[#070A12] transition hover:bg-[#E1C86C] disabled:cursor-not-allowed disabled:opacity-50 lg:min-w-38"
        >
          {isLoading ? loadingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
