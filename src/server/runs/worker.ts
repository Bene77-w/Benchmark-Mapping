import { setTimeout as sleep } from "node:timers/promises";
import type { Database } from "@/server/db/database";
import { processNextRun, type RunnerDeps } from "./runner";

export interface WorkerOptions {
  /** Wartezeit, wenn kein Lauf wartet oder die Datenbank nicht erreichbar ist. */
  pollIntervalMs?: number;
  /** Beendet die Schleife nach dem aktuellen Lauf. */
  signal?: AbortSignal;
  onRun?: (runId: number) => void;
  onError?: (error: unknown) => void;
}

/**
 * Worker-Schleife: arbeitet wartende Läufe nacheinander ab und fragt sonst im Abstand `pollIntervalMs` nach.
 * Läuft im eigenen Prozess (`pnpm worker`), unabhängig von der GUI; mehrere Worker sind möglich.
 */
export async function runWorker(db: Database, deps: RunnerDeps, options: WorkerOptions = {}): Promise<void> {
  const { pollIntervalMs = 1000, signal } = options;
  while (!signal?.aborted) {
    let runId: number | null = null;
    try {
      runId = await processNextRun(db, deps);
      if (runId !== null) options.onRun?.(runId);
    } catch (error) {
      options.onError?.(error);
    }
    if (runId === null) await sleep(pollIntervalMs, undefined, { signal }).catch(() => {});
  }
}
