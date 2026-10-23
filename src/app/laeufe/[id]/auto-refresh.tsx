"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Lädt die Seite im Abstand `intervalMs` neu, solange `active` gilt (Live-Fortschritt eines Laufs). */
export function AutoRefresh({ active, intervalMs = 1000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
