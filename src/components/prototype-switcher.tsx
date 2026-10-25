"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

/**
 * PROTOTYP – wegwerfen: schwebende Umschaltleiste für UI-Varianten (`?variant=`), unten mittig. Pfeile und
 * Tastatur (← →) wechseln zyklisch. Die Wahl steht zusätzlich im Cookie `prototype-variant`, damit Links der
 * Seite, die `variant` nicht kennen (z. B. Filter), die Variante behalten. Außerhalb von production sichtbar.
 */
export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: { key: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  );

  const go = useCallback(
    (step: number) => {
      const next = variants[(index + step + variants.length) % variants.length];
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", next.key);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [index, variants, pathname, router, searchParams],
  );

  // Variante merken; Adresse ohne `variant` (nach einem Filter-Link): Variante wieder in die Adresse schreiben.
  useEffect(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: Prototyp; Cookie Store API ist nicht überall verfügbar
    document.cookie = `prototype-variant=${current}; path=/; SameSite=Lax`;
    if (searchParams.get("variant")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", current);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [current, pathname, router, searchParams]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      go(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (process.env.NODE_ENV === "production") return null;
  const variant = variants[index];
  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-950 px-2 py-1.5 text-sm text-white shadow-lg ring-1 ring-white/20"
      data-testid="prototype-switcher"
    >
      <button
        type="button"
        onClick={() => go(-1)}
        className="rounded-full px-2.5 py-0.5 hover:bg-white/15"
        aria-label="Vorige Variante"
      >
        ←
      </button>
      <span className="px-2 tabular-nums">
        <span className="text-white/60">Prototyp </span>
        {index + 1}/{variants.length} · {variant.key} ({variant.name})
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        className="rounded-full px-2.5 py-0.5 hover:bg-white/15"
        aria-label="Nächste Variante"
      >
        →
      </button>
    </div>
  );
}
