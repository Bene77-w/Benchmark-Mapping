import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import { configurations, runs, unitResults } from "@/server/db/schema";
import { buildBenchmarkPrompt } from "@/server/prompt/benchmark-prompt";
import { getCurrentSnapshot, getSnapshotContent } from "@/server/snapshot/store";
import {
  type Configuration,
  type ConfigurationView,
  DEFAULT_PARALLELISM,
  DEFAULT_TIMEOUT_MS,
  type RunProgress,
  type RunRequest,
  type RunSummary,
  type RunView,
  runRequestSchema,
  type UnitResultStatus,
  type UnitResultView,
} from "./model";

/**
 * Läufe in der Datenbank: anlegen (der Worker führt sie aus) und lesen für GUI und Auswertung.
 * Ein Lauf bezieht sich auf den aktuellen Snapshot; seine Units stehen als Unit-Ergebnisse (`pending`) fest.
 */

export interface PromptRootOption {
  /** Wurzel der Prompt-Dateien, Standard `data/prompts` (nur für Tests). */
  promptRoot?: string;
}

/** Legt einen Lauf an (Status `queued`); ungültige Aufträge und unbekannte Units sind Fehler. */
export async function createRun(
  db: Database,
  request: RunRequest,
  options: PromptRootOption = {},
): Promise<{ runId: number }> {
  const parsed = runRequestSchema.parse(request);
  const current = await getCurrentSnapshot(db);
  const snapshot = current && (await getSnapshotContent(db, current.snapshotId));
  if (!snapshot) throw new Error("Kein Snapshot geladen");
  const known = new Set(snapshot.units.map((unit) => unit.unitId));
  const unknown = parsed.unitIds.filter((unitId) => !known.has(unitId));
  if (unknown.length > 0) throw new Error(`Units gibt es im Snapshot nicht: ${unknown.join(", ")}`);
  const prompt = await buildBenchmarkPrompt(
    snapshot,
    { runKind: parsed.kind, mode: parsed.configuration.mode },
    { promptRoot: options.promptRoot },
  );

  return db.transaction(async (tx) => {
    const configurationId = await ensureConfiguration(tx, parsed.configuration);
    const [run] = await tx
      .insert(runs)
      .values({
        configurationId,
        kind: parsed.kind,
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.contentHash,
        promptVersion: prompt.version,
        promptHash: prompt.promptHash,
        outputSchemaVersion: prompt.outputSchemaVersion,
        outputSchemaHash: prompt.outputSchemaHash,
        parallelism: parsed.parallelism,
        timeoutMs: parsed.timeoutMs,
      })
      .returning({ id: runs.id });
    await tx.insert(unitResults).values(parsed.unitIds.map((unitId) => ({ runId: run.id, unitId })));
    return { runId: run.id };
  });
}

/**
 * Startet eine gespeicherte Konfiguration erneut: neuer Lauf mit Parallelität und Timeout ihres letzten
 * Laufs (sonst Standardwerte) über die angegebenen Units.
 */
export async function createRunFromConfiguration(
  db: Database,
  configurationId: number,
  unitIds: string[],
  options: PromptRootOption = {},
): Promise<{ runId: number }> {
  const [configuration] = await db
    .select()
    .from(configurations)
    .where(eq(configurations.id, configurationId));
  if (!configuration) throw new Error(`Konfiguration ${configurationId} gibt es nicht`);
  const [latest] = await db
    .select({ parallelism: runs.parallelism, timeoutMs: runs.timeoutMs })
    .from(runs)
    .where(eq(runs.configurationId, configurationId))
    .orderBy(desc(runs.id))
    .limit(1);
  return createRun(
    db,
    {
      configuration: toConfiguration(configuration),
      parallelism: latest?.parallelism ?? DEFAULT_PARALLELISM,
      timeoutMs: latest?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      unitIds,
    },
    options,
  );
}

export async function getRun(db: Database, runId: number): Promise<RunView | null> {
  const [summary] = await selectRunSummaries(db, runId);
  if (!summary) return null;
  const rows = await db
    .select()
    .from(unitResults)
    .where(eq(unitResults.runId, runId))
    .orderBy(asc(unitResults.unitId));
  return { ...summary, units: rows.map(toUnitResultView) };
}

/** Alle Läufe, neueste zuerst. */
export async function listRuns(db: Database): Promise<RunSummary[]> {
  return selectRunSummaries(db);
}

export interface SavedConfiguration extends ConfigurationView {
  runCount: number;
  latestRunId: number | null;
}

/** Gespeicherte Konfigurationen, zuletzt gelaufene zuerst. */
export async function listConfigurations(db: Database): Promise<SavedConfiguration[]> {
  const rows = await db.select().from(configurations);
  const runRows = await db
    .select({ id: runs.id, configurationId: runs.configurationId })
    .from(runs)
    .orderBy(desc(runs.id));
  const runsByConfiguration = Map.groupBy(runRows, (run) => run.configurationId);
  return rows
    .map((row) => {
      const ofConfiguration = runsByConfiguration.get(row.id) ?? [];
      return {
        id: row.id,
        ...toConfiguration(row),
        runCount: ofConfiguration.length,
        latestRunId: ofConfiguration[0]?.id ?? null,
      };
    })
    .sort((a, b) => (b.latestRunId ?? 0) - (a.latestRunId ?? 0) || b.id - a.id);
}

async function ensureConfiguration(db: Database, configuration: Configuration): Promise<number> {
  const [inserted] = await db
    .insert(configurations)
    .values(configuration)
    .onConflictDoNothing()
    .returning({ id: configurations.id });
  if (inserted) return inserted.id;
  const [existing] = await db
    .select({ id: configurations.id })
    .from(configurations)
    .where(
      and(
        eq(configurations.harness, configuration.harness),
        eq(configurations.model, configuration.model),
        eq(configurations.effort, configuration.effort),
        eq(configurations.mode, configuration.mode),
      ),
    );
  return existing.id;
}

async function selectRunSummaries(db: Database, runId?: number): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: runs, configuration: configurations })
    .from(runs)
    .innerJoin(configurations, eq(runs.configurationId, configurations.id))
    .where(runId === undefined ? undefined : eq(runs.id, runId))
    .orderBy(desc(runs.id));
  if (rows.length === 0) return [];
  const counts = await db
    .select({ runId: unitResults.runId, status: unitResults.status, value: count() })
    .from(unitResults)
    .where(
      inArray(
        unitResults.runId,
        rows.map((row) => row.run.id),
      ),
    )
    .groupBy(unitResults.runId, unitResults.status);
  return rows.map(({ run, configuration }) => ({
    id: run.id,
    kind: run.kind,
    status: run.status,
    error: run.error,
    configuration: { id: configuration.id, ...toConfiguration(configuration) },
    snapshotId: run.snapshotId,
    snapshotHash: run.snapshotHash,
    promptVersion: run.promptVersion,
    promptHash: run.promptHash,
    outputSchemaVersion: run.outputSchemaVersion,
    outputSchemaHash: run.outputSchemaHash,
    parallelism: run.parallelism,
    timeoutMs: run.timeoutMs,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    progress: toProgress(counts.filter((row) => row.runId === run.id)),
  }));
}

function toProgress(counts: { status: UnitResultStatus; value: number }[]): RunProgress {
  const progress: RunProgress = { total: 0, pending: 0, running: 0, done: 0, failed: 0 };
  for (const { status, value } of counts) {
    progress[status] += value;
    progress.total += value;
  }
  return progress;
}

function toConfiguration(row: typeof configurations.$inferSelect): Configuration {
  return { harness: row.harness, model: row.model, effort: row.effort, mode: row.mode };
}

function toUnitResultView(row: typeof unitResults.$inferSelect): UnitResultView {
  const hasTokens =
    row.inputTokens !== null &&
    row.cacheReadTokens !== null &&
    row.cacheWriteTokens !== null &&
    row.outputTokens !== null;
  return {
    unitId: row.unitId,
    status: row.status,
    attempts: row.attempts,
    unitPromptHash: row.unitPromptHash,
    answer: row.answer,
    error: row.errorKind
      ? { kind: row.errorKind, message: row.errorMessage, rateLimitResetAt: row.rateLimitResetAt }
      : null,
    rawResponse: row.rawResponse,
    log: row.log,
    tokens: hasTokens
      ? {
          inputTokens: row.inputTokens as number,
          cacheReadTokens: row.cacheReadTokens as number,
          cacheWriteTokens: row.cacheWriteTokens as number,
          outputTokens: row.outputTokens as number,
          reasoningTokens: row.reasoningTokens,
        }
      : null,
    webSearches: row.webSearches,
    effort:
      row.effortConfirmed === null ? null : { reported: row.effortReported, confirmed: row.effortConfirmed },
    nativeCostUsd: row.nativeCostUsd,
    durationMs: row.durationMs,
    exitCode: row.exitCode,
    cliVersion: row.cliVersion,
    modelReported: row.modelReported,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
