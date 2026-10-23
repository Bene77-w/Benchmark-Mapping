import type { UnitAnswer } from "@/server/prompt/output-schema";

/**
 * Einfache Bewertung für den Durchstich: Unit-Score als F1 aus Recall auf positiv und Präzision auf
 * positiv ∪ vertretbar; no_mapping-Units 1 bei no_mapping, sonst 0; ohne Antwort (Format-Fehler) 0.
 * Ohne web_only, Regelverstöße und Intervall – das ist die vollständige Bewertung (#5).
 */

export interface SimpleGoldUnit {
  unitId: string;
  noMapping: boolean;
  industries: { industryId: string; class: "positiv" | "vertretbar" }[];
}

export function simpleUnitScore(answer: UnitAnswer | null, gold: SimpleGoldUnit): number {
  if (answer === null) return 0;
  if (gold.noMapping) return answer.decision === "no_mapping" ? 1 : 0;
  const named = new Set<string>(
    answer.decision === "mapped" ? answer.assignments.map((assignment) => assignment.industry_id) : [],
  );
  const positive = new Set(
    gold.industries.filter((entry) => entry.class === "positiv").map((entry) => entry.industryId),
  );
  const allowed = new Set(gold.industries.map((entry) => entry.industryId));
  if (named.size === 0 || positive.size === 0) return 0;
  const recall = [...positive].filter((id) => named.has(id)).length / positive.size;
  const precision = [...named].filter((id) => allowed.has(id)).length / named.size;
  return recall + precision === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/** Mittelwert der Unit-Scores über alle Gold-Units; Units ohne Antwort zählen 0. */
export function simpleRunScore(
  answers: ReadonlyMap<string, UnitAnswer | null>,
  gold: readonly SimpleGoldUnit[],
): { score: number; unitScores: Map<string, number> } {
  const unitScores = new Map(
    gold.map((unit) => [unit.unitId, simpleUnitScore(answers.get(unit.unitId) ?? null, unit)]),
  );
  const total = [...unitScores.values()].reduce((sum, value) => sum + value, 0);
  return { score: gold.length === 0 ? 0 : total / gold.length, unitScores };
}
