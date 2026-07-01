"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type ExperienceMode = "product-search" | "outfit-creator";

const MODES: { id: ExperienceMode; href: string; label: string }[] = [
  { id: "product-search", href: "/product-search", label: "Product Search" },
  { id: "outfit-creator", href: "/outfit-creator", label: "LuxeAgent Chat" },
];

type ExperienceShellProps = {
  /** Which tab is active (also used as the fallback when no path matches). */
  active: ExperienceMode;
  /** Small uppercased eyebrow above the headline. */
  eyebrow: string;
  /** The big serif headline. */
  title: string;
  /** Supporting paragraph under the headline. */
  subtitle: string;
  /** The mode-specific content (search UI or outfit UI). */
  children: ReactNode;
};

/**
 * Shared chrome for both experiences: the luxury hero, the brand header, the
 * footer, and the `[Product Search] [Outfit Creator]` tab bar. The active tab
 * is derived from the route (with `active` as a fallback) and tabs navigate via
 * `next/link`, so the two modes are real, shareable routes.
 */
export function ExperienceShell({
  active,
  eyebrow,
  title,
  subtitle,
  children,
}: ExperienceShellProps) {
  const pathname = usePathname();
  const currentMode: ExperienceMode =
    MODES.find((mode) => pathname?.startsWith(mode.href))?.id ?? active;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070D] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-[#C9A84C]/12 blur-3xl" />
        <div className="absolute right-0 top-1/4 h-[28rem] w-[28rem] rounded-full bg-[#10264A]/50 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_35%),linear-gradient(180deg,rgba(5,7,13,0)_0%,#05070D_82%)]" />
      </div>

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#C9A84C] sm:text-sm">
              LUXEAGENT
            </p>
            <p className="mt-1 text-sm text-white/50">AI-powered luxury fashion concierge</p>
          </div>
          <div className="hidden rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs uppercase tracking-[0.24em] text-white/60 sm:block">
            Curated By AI
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-10 pb-12 pt-10 lg:gap-12 lg:pt-16">
          <section className="mx-auto flex w-full max-w-5xl flex-col items-center text-center">
            <div className="inline-flex rounded-full border border-[#C9A84C]/30 bg-[#C9A84C]/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-[#F3D884]">
              {eyebrow}
            </div>
            <h1 className="mt-7 font-serif text-6xl leading-[0.92] tracking-[-0.045em] text-white sm:text-7xl lg:text-8xl">
              {title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-white/62 sm:text-xl">
              {subtitle}
            </p>

            <nav
              aria-label="Experience mode"
              className="mt-8 inline-flex rounded-full border border-white/10 bg-white/[0.05] p-1 backdrop-blur"
            >
              {MODES.map((mode) => {
                const isActive = mode.id === currentMode;
                return (
                  <Link
                    key={mode.id}
                    href={mode.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`rounded-full px-5 py-3 text-sm font-semibold uppercase tracking-[0.22em] transition ${
                      isActive
                        ? "bg-[#C9A84C] text-[#070A12]"
                        : "text-white/55 hover:text-white"
                    }`}
                  >
                    {mode.label}
                  </Link>
                );
              })}
            </nav>
          </section>

          {children}
        </div>

        <footer className="relative border-t border-white/10 py-5 text-center text-xs uppercase tracking-[0.28em] text-white/35">
          Bespoke discovery for modern luxury wardrobes
        </footer>
      </section>
    </main>
  );
}
