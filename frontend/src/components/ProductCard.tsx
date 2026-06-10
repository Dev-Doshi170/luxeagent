"use client";

import { useState } from "react";
import type { Product } from "@/types/product";

type ProductCardProps = {
  product: Product;
};

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='1000' viewBox='0 0 800 1000'%3E%3Crect width='800' height='1000' fill='%23101622'/%3E%3Cpath d='M190 710h420L528 315c-39 30-78 45-128 45s-89-15-128-45l-82 395Z' fill='%231A2334' stroke='%23C9A84C' stroke-width='8'/%3E%3Ccircle cx='400' cy='240' r='72' fill='%231A2334' stroke='%23C9A84C' stroke-width='8'/%3E%3Ctext x='400' y='820' fill='%23C9A84C' font-family='Arial, sans-serif' font-size='38' text-anchor='middle' letter-spacing='6'%3ELUXEAGENT%3C/text%3E%3C/svg%3E";

export function ProductCard({ product }: ProductCardProps) {
  const [imageSrc, setImageSrc] = useState(product.image_url || PLACEHOLDER_IMAGE);
  const score = Math.max(0, Math.min(1, product.final_score ?? 0));

  return (
    <article className="group w-full min-w-0 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/20 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-[#C9A84C]/50 hover:shadow-[#C9A84C]/10">
      <div className="relative aspect-square overflow-hidden bg-[#101622]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={product.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          onError={() => setImageSrc(PLACEHOLDER_IMAGE)}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#05070D]/80 via-transparent to-transparent opacity-80" />
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-[#C9A84C]/40 bg-[#C9A84C]/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#F3D884]">
              {product.article_type || "Fashion"}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-white/70">
              {product.gender || "Unisex"}
            </span>
          </div>
          <h3 className="text-base font-medium leading-snug text-white sm:text-lg">
            {product.name}
          </h3>
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-white/40">
            ID: {product.id}
          </p>
        </div>

        <div className="space-y-3 text-sm text-white/62">
          <div className="flex items-center justify-between gap-3">
            <span>Colour</span>
            <span className="text-right text-white/85">{product.colour || "Curated"}</span>
          </div>
          {product.usage_type ? (
            <div className="flex items-center justify-between gap-3">
              <span>Occasion</span>
              <span className="text-right text-white/85">{product.usage_type}</span>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs font-medium text-white/65">
            <span>Relevance: {score.toFixed(2)}</span>
            <span className="text-[#F3D884]">{Math.round(score * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#8C6A1F] via-[#C9A84C] to-[#F5E6A7]"
              style={{ width: `${score * 100}%` }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
