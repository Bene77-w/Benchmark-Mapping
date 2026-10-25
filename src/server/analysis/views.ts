import type { HarnessErrorKind } from "@/server/harness/adapter";
import type { ConfigurationView } from "@/server/runs/model";
import { CATEGORIES, type Category } from "@/server/scoring/model";
import type { AnalysisEntry } from "./leaderboard";

/**
 * Weitere Ansichten der Auswertung (Kategorie-Diagramm, Heatmap, Verlauf). Sie bauen auf `buildAnalysis` auf
 * und zeigen deshalb dieselben Läufe unter denselben Filtern und Vergleichbarkeitsregeln.
 */

/** Zelle der Heatmap: Unit-Score einer Antwort oder eine Fehlerart (Score 0, aber kein falsches Mapping). */
export interface HeatmapCell {
  unitId: string;
  /** score = bewertete Antwort; format_error = Timeout, ungültiges JSON, Schemaverstoß; harness_failure = sonstiger Harness-Fehler. */
  kind: "score" | "format_error" | "harness_failure";
  score: number;
  errorKind: HarnessErrorKind | null;
}

export interface HeatmapRow {
  runId: number;
  configuration: ConfigurationView;
  score: number;
  cells: HeatmapCell[];
}

export interface Heatmap {
  /** Spalten: Gold-Units nach Kategorie, darin nach unit_id. */
  units: { unitId: string; category: Category }[];
  /** Zeilen: die Läufe der Rangliste in deren Reihenfolge. */
  rows: HeatmapRow[];
}

export function buildHeatmap(entries: AnalysisEntry[]): Heatmap {
  const categories = new Map<string, Category>();
  for (const entry of entries) {
    for (const unit of entry.evaluation.units) categories.set(unit.unitId, unit.category);
  }
  const units = [...categories]
    .map(([unitId, category]) => ({ unitId, category }))
    .sort(
      (a, b) =>
        CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
        (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0),
    );
  const rows = entries.map((entry) => {
    const byUnit = new Map(entry.evaluation.units.map((unit) => [unit.unitId, unit]));
    const cells = units.flatMap(({ unitId }): HeatmapCell[] => {
      const unit = byUnit.get(unitId);
      if (!unit || unit.status === "missing") return [];
      const kind =
        unit.status === "format_error"
          ? "format_error"
          : unit.status === "failed"
            ? "harness_failure"
            : "score";
      return [{ unitId, kind, score: unit.score ?? 0, errorKind: unit.errorKind }];
    });
    return { runId: entry.runId, configuration: entry.configuration, score: entry.score, cells };
  });
  return { units, rows };
}
