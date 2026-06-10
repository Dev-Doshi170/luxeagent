/**
 * Search Trace Logging
 * --------------------
 * Tiny, dependency-free helpers for printing a readable, end-to-end trace of a
 * query as it flows through the search/outfit pipeline. The goal is full
 * visibility in the server console: what the user asked for, how it was parsed,
 * what was actually queried against the catalog, what got filtered out, and what
 * we ended up returning.
 *
 * These only write to the server-side console (Next.js terminal), never to the
 * client, and never throw — logging must never break a request.
 */

import type { Product } from "@/types/product";
import type { RankedProduct } from "@/lib/retrieval-orchestrator";

/** Print a labelled section banner so the trace is easy to scan in the console. */
export function logSection(tag: string, label: string): void {
  console.log(`\n${tag} ──────── ${label} ────────`);
}

/** Compact one-line summary of a single product for the console. */
export function summarizeProduct(product: Product | RankedProduct): string {
  const ranked = product as RankedProduct;
  const category = ranked.outfit_category ? `/${ranked.outfit_category}` : "";
  const via = ranked.matched_term ? ` via "${ranked.matched_term}"` : "";
  const score =
    typeof product.final_score === "number"
      ? product.final_score.toFixed(3)
      : "n/a";
  const brand = product.brand ? ` ${product.brand}` : "";
  return (
    `#${product.id} "${product.name}"${brand} ` +
    `[${product.article_type}${category}] ` +
    `${product.gender}/${product.usage_type} ${product.colour} ` +
    `score=${score}${via}`
  );
}

/**
 * Log a list of products as an indented, numbered block. Truncates long lists
 * to `limit` lines (with a "+N more" footer) so a big result set stays readable.
 */
export function logProducts(
  tag: string,
  label: string,
  products: (Product | RankedProduct)[],
  limit = 12,
): void {
  console.log(`${tag} ${label} (${products.length}):`);
  if (products.length === 0) {
    console.log(`${tag}   (none)`);
    return;
  }
  const shown = products.slice(0, limit);
  shown.forEach((product, index) => {
    console.log(`${tag}   ${index + 1}. ${summarizeProduct(product)}`);
  });
  if (products.length > limit) {
    console.log(`${tag}   …and ${products.length - limit} more`);
  }
}

/** Count products per outfit category for a quick composition snapshot. */
export function categoryBreakdown(
  products: RankedProduct[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const product of products) {
    const key = product.outfit_category ?? "unclassified";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
