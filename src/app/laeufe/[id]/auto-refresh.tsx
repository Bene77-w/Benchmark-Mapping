"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/**
 * Lädt die Seite neu, solange `active` gilt (Live-Fortschritt eines Laufs): `intervalMs` nach dem Ende der
 * vorigen Aktualisierung, nie während einer noch laufenden. Ein fester Takt würde bei einer Antwortzeit über
 * `intervalMs` (Dev-Server unter Last) jede Aktualisierung durch die nächste verdrängen; die Seite bliebe stehen.
 */
export function AutoRefresh({ active, intervalMs = 1000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    if (!active || refreshing) return;
    const timer = setTimeout(() => startRefresh(() => router.refresh()), intervalMs);
    return () => clearTimeout(timer);
  }, [active, refreshing, intervalMs, router]);
  return null;
}
