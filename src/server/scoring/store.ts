import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import { evaluations, unitResults } from "@/server/db/schema";
import type { RunView } from "@/server/runs/model";
import { getRun } from "@/server/runs/store";
import { hashCanonical } from "@/server/snapshot/hash";
import { getSnapshotContent } from "@/server/snapshot/store";
import { evaluateRun } from "./evaluate";
import { type GoldVersion, type RunEvaluation, SCORING_VERSION, type UnitOutcome } from "./model";

/**
 * Bewertungen in der Datenbank: je (Lauf, Gold-Version) eine gespeicherte Bewertung. Gespeichert wird nur
 * für abgeschlossene Läufe; passt die gespeicherte Bewertung nicht mehr zum Gold-Inhalt oder Regelstand,
 * wird sie neu berechnet und ersetzt.
 */

export interface StoredEvaluation {
  goldVersion: string;
  goldHash: string;
  scoringVersion: string;
  complete: boolean;
  score: number | null;
  interval: { low: number; high: number } | null;
  formatErrors: number;
  violationCount: number;
  evidenceFidelity: number | null;
  evaluatedAt: Date;
}

/**
 * Bewertung des Laufs gegen die Gold-Version; `null`, wenn es den Lauf nicht gibt. Abgeschlossene Läufe
 * werden einmal bewertet und gespeichert, laufende nur berechnet.
 */
export async function ensureEvaluation(
  db: Database,
  runId: number,
  gold: GoldVersion,
): Promise<RunEvaluation | null> {
  const run = await getRun(db, runId);
  if (!run) return null;
  const goldHash = hashCanonical(gold);
  if (run.status === "completed") {
    const stored = (await currentStoredEvaluations(db, [runId], gold)).get(runId);
    if (stored) return stored;
  }

  const evaluation = await evaluate(db, run, gold);
  if (run.status === "completed") {
    const values = {
      runId,
      goldVersion: gold.version,
      goldHash,
      scoringVersion: evaluation.scoringVersion,
      complete: evaluation.complete,
      score: evaluation.score,
      intervalLow: evaluation.interval?.low ?? null,
      intervalHigh: evaluation.interval?.high ?? null,
      formatErrors: evaluation.formatErrors,
      violationCount: Object.values(evaluation.violations).reduce((sum, count) => sum + count, 0),
      evidenceFidelity: evaluation.evidenceFidelity,
      result: evaluation,
      evaluatedAt: new Date(),
    };
    await db
      .insert(evaluations)
      .values(values)
      .onConflictDoUpdate({ target: [evaluations.runId, evaluations.goldVersion], set: values });
  }
  return evaluation;
}

/**
 * Wie `ensureEvaluation` für mehrere abgeschlossene Läufe: gespeicherte, noch gültige Bewertungen kommen aus
 * wenigen Abfragen, nur die übrigen Läufe werden (neu) bewertet. Läufe, die es nicht gibt, fehlen im Ergebnis.
 */
export async function ensureEvaluations(
  db: Database,
  runIds: number[],
  gold: GoldVersion,
): Promise<Map<number, RunEvaluation>> {
  const stored = await currentStoredEvaluations(db, runIds, gold);
  const result = new Map<number, RunEvaluation>();
  for (const runId of runIds) {
    const evaluation = stored.get(runId) ?? (await ensureEvaluation(db, runId, gold));
    if (evaluation) result.set(runId, evaluation);
  }
  return result;
}

/**
 * Gespeicherte Bewertungen der Läufe gegen die Gold-Version, die noch gültig sind; je Lauf höchstens eine.
 * Gültig ist eine Bewertung, solange Gold-Inhalt (Hash) und Regelstand passen und – bei einer unvollständigen –
 * keine ihrer fehlenden Units inzwischen ein Ergebnis hat (Ergänzung). Vorhandene Ergebnisse eines
 * abgeschlossenen Laufs ändern sich nicht mehr, deshalb bleibt eine vollständige Bewertung gültig.
 */
export async function currentStoredEvaluations(
  db: Database,
  runIds: number[],
  gold: GoldVersion,
): Promise<Map<number, RunEvaluation>> {
  if (runIds.length === 0) return new Map();
  const goldHash = hashCanonical(gold);
  const rows = await db
    .select({
      runId: evaluations.runId,
      result: evaluations.result,
      goldHash: evaluations.goldHash,
      scoringVersion: evaluations.scoringVersion,
    })
    .from(evaluations)
    .where(and(inArray(evaluations.runId, runIds), eq(evaluations.goldVersion, gold.version)));
  const current = rows.filter((row) => row.goldHash === goldHash && row.scoringVersion === SCORING_VERSION);
  const incompleteRunIds = current.filter((row) => !row.result.complete).map((row) => row.runId);
  const finished =
    incompleteRunIds.length === 0
      ? []
      : await db
          .select({ runId: unitResults.runId, unitId: unitResults.unitId })
          .from(unitResults)
          .where(
            and(
              inArray(unitResults.runId, incompleteRunIds),
              inArray(unitResults.status, ["done", "failed"]),
            ),
          );
  const finishedByRun = Map.groupBy(finished, (row) => row.runId);
  const supplemented = (row: (typeof current)[number]) => {
    const results = new Set((finishedByRun.get(row.runId) ?? []).map((entry) => entry.unitId));
    return row.result.missingUnitIds.some((unitId) => results.has(unitId));
  };
  return new Map(current.filter((row) => !supplemented(row)).map((row) => [row.runId, row.result]));
}

/** Gespeicherte Bewertungen eines Laufs, nach Gold-Version sortiert. */
export async function listEvaluations(db: Database, runId: number): Promise<StoredEvaluation[]> {
  const rows = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.runId, runId))
    .orderBy(asc(evaluations.goldVersion));
  return rows.map((row) => ({
    goldVersion: row.goldVersion,
    goldHash: row.goldHash,
    scoringVersion: row.scoringVersion,
    complete: row.complete,
    score: row.score,
    interval:
      row.intervalLow === null || row.intervalHigh === null
        ? null
        : { low: row.intervalLow, high: row.intervalHigh },
    formatErrors: row.formatErrors,
    violationCount: row.violationCount,
    evidenceFidelity: row.evidenceFidelity,
    evaluatedAt: row.evaluatedAt,
  }));
}

async function evaluate(db: Database, run: RunView, gold: GoldVersion): Promise<RunEvaluation> {
  const snapshot = await getSnapshotContent(db, run.snapshotId);
  if (!snapshot) throw new Error(`Snapshot ${run.snapshotId} fehlt`);
  const outcomes = new Map<string, UnitOutcome>();
  for (const unit of run.units) {
    if (unit.status === "done" && unit.answer)
      outcomes.set(unit.unitId, { kind: "answer", answer: unit.answer });
    if (unit.status === "failed" && unit.error) {
      outcomes.set(unit.unitId, { kind: "failed", errorKind: unit.error.kind });
    }
  }
  return evaluateRun({
    mode: run.configuration.mode,
    gold,
    outcomes,
    units: snapshot.units,
    industryIds: snapshot.industries.map((industry) => industry.industryId),
  });
}
