const QUERY_EXPANSIONS: Record<string, string[]> = {
  luxury: ["designer", "premium", "high quality"],
  premium: ["luxury", "designer", "high quality"],
  designer: ["luxury", "premium"],
  handbag: ["bag", "purse", "leather handbag", "designer handbag"],
  handbags: ["bag", "purse", "leather handbag", "designer handbag"],
  bag: ["handbag", "purse"],
  watch: ["timepiece", "wrist watch", "premium watch"],
  watches: ["timepiece", "wrist watch", "premium watch"],
  formal: ["office", "business", "dressy"],
  office: ["formal", "business"],
  shirt: ["shirts", "topwear", "button down"],
  shirts: ["shirt", "topwear", "button down"],
  tshirt: ["t-shirt", "tee", "casual top"],
  tshirts: ["t-shirt", "tee", "casual top"],
  "t-shirt": ["tshirt", "tee", "casual top"],
  jeans: ["denim", "blue jeans"],
  shoes: ["footwear"],
  sunglasses: ["shades", "eyewear"],
  kurta: ["ethnic wear", "traditional"],
  kurtas: ["ethnic wear", "traditional"],
  dress: ["dresses", "gown", "party wear"],
  dresses: ["dress", "gown", "party wear"],
};

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function expandQuery(query: string, maxAddedTerms = 12): string {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  if (!normalizedQuery) return "";

  const additions: string[] = [];
  const seen = new Set<string>([
    normalizedQuery.toLowerCase(),
    ...tokenize(normalizedQuery),
  ]);

  for (const token of tokenize(normalizedQuery)) {
    for (const expansion of QUERY_EXPANSIONS[token] ?? []) {
      const normalizedExpansion = expansion.toLowerCase();
      if (seen.has(normalizedExpansion)) continue;

      additions.push(expansion);
      seen.add(normalizedExpansion);
      if (additions.length >= maxAddedTerms) {
        return [normalizedQuery, ...additions].join(" ");
      }
    }
  }

  return [normalizedQuery, ...additions].join(" ");
}
