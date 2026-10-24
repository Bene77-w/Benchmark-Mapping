import type { Database } from "@/server/db/database";
import type { RunSummary } from "@/server/runs/model";
import { listEvaluationRuns } from "@/server/runs/store";
import type { GoldVersion, RunEvaluation } from "./model";
import { currentStoredEvaluations, ensureEvaluations } from "./store";

/**
 * Auswertungsgrundlage gegen eine Gold-Version (in der App die aktuelle, siehe `getActiveGold`): welche Läufe
 * in Rangliste und Diagrammen erscheinen und mit welcher Bewertung. Auswertbar sind abgeschlossene
 * Benchmark-Läufe mit einem Ergebnis für jede Unit der Gold-Version; Vorschlagsläufe, abgebrochene,
 * fehlgeschlagene und laufende Läufe nie. Abgeschlossene Läufe, denen Ergebnisse für Units der Gold-Version
 * fehlen, sind „unvollständig für die Gold-Version“ und ausgeblendet, bis sie ergänzt sind.
 */

export interface EvaluatedRun {
  run: RunSummary;
  /** Vollständige Bewertung (`complete`, Score und Intervall gesetzt). */
  evaluation: RunEvaluation;
}

export interface IncompleteRun {
  run: RunSummary;
  /** Units der Gold-Version ohne Ergebnis in diesem Lauf. */
  missingUnitIds: string[];
}

export interface CurrentEvaluations {
  goldVersion: string;
  /** Auswertbare Läufe, neueste zuerst. */
  runs: EvaluatedRun[];
  /** Ausgeblendete, unvollständige Läufe, neueste zuerst. */
  incomplete: IncompleteRun[];
}

/** Stand der Neubewertung: wie viele auswertbare Läufe eine gültige Bewertung gegen die Gold-Version haben. */
export interface ReevaluationStatus {
  goldVersion: string;
  /** Abgeschlossene Benchmark-Läufe (Kandidaten der Auswertung). */
  runs: number;
  /** Davon mit gespeicherter Bewertung, die zum Gold-Inhalt und Regelstand passt. */
  evaluated: number;
  complete: number;
  incomplete: number;
}

/**
 * Auswertbare Läufe mit ihrer Bewertung gegen die Gold-Version, dazu die ausgeblendeten unvollständigen.
 * Fehlende oder veraltete Bewertungen werden dabei berechnet und gespeichert (ohne Modellaufruf).
 */
export async function listCurrentEvaluations(db: Database, gold: GoldVersion): Promise<CurrentEvaluations> {
  const candidates = await listEvaluationRuns(db);
  const evaluations = await ensureEvaluations(
    db,
    candidates.map((run) => run.id),
    gold,
  );
  const result: CurrentEvaluations = { goldVersion: gold.version, runs: [], incomplete: [] };
  for (const run of candidates) {
    const evaluation = evaluations.get(run.id);
    if (!evaluation) continue;
    if (evaluation.complete) result.runs.push({ run, evaluation });
    else result.incomplete.push({ run, missingUnitIds: evaluation.missingUnitIds });
  }
  return result;
}

/** Neubewertung aller abgeschlossenen Benchmark-Läufe gegen die Gold-Version, ohne Modellaufruf. */
export async function reevaluateAllRuns(db: Database, gold: GoldVersion): Promise<ReevaluationStatus> {
  await listCurrentEvaluations(db, gold);
  return getReevaluationStatus(db, gold);
}

/** Stand der gespeicherten Bewertungen gegen die Gold-Version (nur lesen, nichts berechnen). */
export async function getReevaluationStatus(db: Database, gold: GoldVersion): Promise<ReevaluationStatus> {
  const candidates = await listEvaluationRuns(db);
  const stored = [
    ...(
      await currentStoredEvaluations(
        db,
        candidates.map((run) => run.id),
        gold,
      )
    ).values(),
  ];
  const complete = stored.filter((evaluation) => evaluation.complete).length;
  return {
    goldVersion: gold.version,
    runs: candidates.length,
    evaluated: stored.length,
    complete,
    incomplete: stored.length - complete,
  };
}
