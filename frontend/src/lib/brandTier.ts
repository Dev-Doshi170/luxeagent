/**
 * Brand-tier resolution
 * ---------------------
 * Maps the parsed intent's free-form `style` onto a catalog brand tier that the
 * Supabase `hybrid_search` RPC understands via its `filter_brand_tier`
 * parameter. Returning `null` means "no brand-tier filter" (all tiers returned).
 */
export function resolveBrandTier(
  style: string | undefined | null,
): string | null {
  if (!style) return null;
  const s = style.toLowerCase().trim();
  if (s === "luxury" || s === "premium" || s === "designer") return "premium";
  if (s === "affordable" || s === "budget" || s === "cheap") return "budget";
  return null;
}
