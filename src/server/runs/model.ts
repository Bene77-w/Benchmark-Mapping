import { z } from "zod";
import { HARNESSES, type HarnessErrorKind, type TokenUsage } from "@/server/harness/adapter";
import type { PreflightResult } from "@/server/harness/preflight";
import { MODES, RUN_KINDS, type RunKind } from "@/server/prompt/benchmark-prompt";
import type { UnitAnswer } from "@/server/prompt/output-schema";

/**
 * Status eines Laufs: wartet auf den Worker, läuft, abgeschlossen (alle Units haben ein Ergebnis), nicht
 * ausführbar, abgebrochen (fortsetzbar; fertige Units bleiben).
 */
export const RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Status eines Unit-Ergebnisses: offen, laufend, fertig (Antwort), fehlgeschlagen (Fehlerart). */
export const UNIT_RESULT_STATUSES = ["pending", "running", "done", "failed"] as const;
export type UnitResultStatus = (typeof UNIT_RESULT_STATUSES)[number];

export const MIN_PARALLELISM = 1;
export const MAX_PARALLELISM = 5;
export const DEFAULT_PARALLELISM = 3;
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export const configurationSchema = z.object({
  harness: z.enum(HARNESSES),
  model: z.string().trim().min(1, "Modell fehlt"),
  effort: z.string().trim().min(1, "Effort fehlt"),
  mode: z.enum(MODES),
});
export type Configuration = z.infer<typeof configurationSchema>;

/** Auftrag zum Anlegen eines Laufs. */
export const runRequestSchema = z.object({
  configuration: configurationSchema,
  kind: z.enum(RUN_KINDS).default("benchmark"),
  parallelism: z.number().int().min(MIN_PARALLELISM).max(MAX_PARALLELISM).default(DEFAULT_PARALLELISM),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  /** Gold-Version, aus der die Units stammen (am Lauf gespeichert); `null` bei Vorschlagsläufen. */
  goldVersion: z.string().min(1).nullable().default(null),
  /** Units des Laufs; jede muss im aktuellen Snapshot vorkommen. */
  unitIds: z
    .array(z.string().min(1))
    .min(1, "Ein Lauf braucht mindestens eine Unit")
    .refine((ids) => new Set(ids).size === ids.length, "Units doppelt angegeben"),
});
export type RunRequest = z.input<typeof runRequestSchema>;

export interface ConfigurationView extends Configuration {
  id: number;
}

export interface RunProgress {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
}

export interface UnitResultView {
  unitId: string;
  status: UnitResultStatus;
  attempts: number;
  unitPromptHash: string | null;
  answer: UnitAnswer | null;
  error: { kind: HarnessErrorKind; message: string | null; rateLimitResetAt: Date | null } | null;
  rawResponse: string | null;
  log: string | null;
  tokens: TokenUsage | null;
  webSearches: number | null;
  effort: { reported: string | null; confirmed: boolean } | null;
  nativeCostUsd: number | null;
  durationMs: number | null;
  exitCode: number | null;
  cliVersion: string | null;
  modelReported: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface RunSummary {
  id: number;
  kind: RunKind;
  status: RunStatus;
  error: string | null;
  configuration: ConfigurationView;
  snapshotId: number;
  snapshotHash: string;
  promptVersion: string;
  promptHash: string;
  outputSchemaVersion: string;
  outputSchemaHash: string;
  parallelism: number;
  timeoutMs: number;
  /** Gold-Version, deren Units der Lauf beim Start übernommen hat; `null` bei Vorschlagsläufen. */
  goldVersion: string | null;
  /** Ergebnis des Preflights vor der Ausführung; `null`, solange keiner lief. */
  preflight: PreflightResult | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Bei Ratenlimit: wann der Runner das nächste Mal stellvertretend nachfragt; sonst `null`. */
  rateLimitedUntil: Date | null;
  progress: RunProgress;
}

export interface RunView extends RunSummary {
  /** Unit-Ergebnisse, sortiert nach unit_id. */
  units: UnitResultView[];
}
