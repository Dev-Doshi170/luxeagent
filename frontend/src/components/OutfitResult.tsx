import { ProductGrid } from "@/components/ProductGrid";
import {
  OUTFIT_SLOTS,
  OUTFIT_SLOT_LABELS,
  type Outfit,
} from "@/types/outfit";

type OutfitResultProps = {
  outfit: Outfit | null;
  isLoading?: boolean;
  /** The styling brief that produced this outfit (shown as a heading). */
  query?: string;
};

function SlotSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#C9A84C]">
        <span>{label}</span>
        <span className="h-px flex-1 bg-[#C9A84C]/30" />
      </div>
      <ProductGrid products={[]} isLoading compact />
    </div>
  );
}

/**
 * Renders a complete outfit composition as labeled category sections (Tops /
 * Bottoms / Footwear / Accessories), each a compact {@link ProductGrid}. Slots
 * with no matching catalog item are skipped. Reuses the existing card + grid
 * components so the look stays consistent with Product Search.
 */
export function OutfitResult({ outfit, isLoading = false, query }: OutfitResultProps) {
  if (isLoading) {
    return (
      <div className="space-y-8">
        {OUTFIT_SLOTS.map((slot) => (
          <SlotSkeleton key={slot} label={OUTFIT_SLOT_LABELS[slot]} />
        ))}
      </div>
    );
  }

  if (!outfit) return null;

  const filledSlots = OUTFIT_SLOTS.filter((slot) => outfit[slot].length > 0);

  if (filledSlots.length === 0) {
    return (
      <div className="rounded-[2rem] border border-dashed border-[#C9A84C]/30 bg-white/[0.03] px-6 py-14 text-center">
        <p className="text-lg font-medium text-white">No outfit could be composed</p>
        <p className="mt-2 text-sm text-white/55">
          Try a different occasion, season, style, or budget.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-9">
      {query ? (
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#C9A84C]">
            Your Curated Outfit
          </p>
          <h2 className="mt-3 font-serif text-2xl text-white sm:text-3xl">{query}</h2>
        </div>
      ) : null}

      {filledSlots.map((slot) => (
        <div key={slot} className="space-y-4">
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#C9A84C]">
            <span>{OUTFIT_SLOT_LABELS[slot]}</span>
            <span className="h-px flex-1 bg-[#C9A84C]/30" />
          </div>
          <ProductGrid products={outfit[slot]} compact />
        </div>
      ))}
    </div>
  );
}
