import type { Product } from "@/types/product";
import { getProductGridClassNames } from "@/lib/productGridLayout";
import { ProductCard } from "./ProductCard";

type ProductGridProps = {
  products: Product[];
  isLoading?: boolean;
  compact?: boolean;
};

function ProductSkeleton() {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.04]">
      <div className="aspect-square animate-pulse bg-white/10" />
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex gap-2">
          <div className="h-7 w-20 animate-pulse rounded-full bg-white/10" />
          <div className="h-7 w-16 animate-pulse rounded-full bg-white/10" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-white/10" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
        </div>
        <div className="h-1.5 animate-pulse rounded-full bg-white/10" />
      </div>
    </div>
  );
}

export function ProductGrid({ products, isLoading = false, compact = false }: ProductGridProps) {
  const { gridClassName, itemClassName } = getProductGridClassNames(compact);

  if (isLoading) {
    return (
      <div className={gridClassName}>
        {Array.from({ length: compact ? 2 : 8 }).map((_, index) => (
          <div key={index} className={itemClassName}>
            <ProductSkeleton />
          </div>
        ))}
      </div>
    );
  }

  if (!products.length) {
    return (
      <div className="rounded-[2rem] border border-dashed border-[#C9A84C]/30 bg-white/[0.03] px-6 py-14 text-center">
        <p className="text-lg font-medium text-white">No products found</p>
        <p className="mt-2 text-sm text-white/55">
          Try a different style, colour, category, or occasion.
        </p>
      </div>
    );
  }

  return (
    <div className={gridClassName}>
      {products.map((product) => (
        <div key={product.id} className={itemClassName}>
          <ProductCard product={product} />
        </div>
      ))}
    </div>
  );
}
