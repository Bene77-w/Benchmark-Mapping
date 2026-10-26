import type { HarnessErrorKind } from "@/server/harness/adapter";
import type { ConfigurationView } from "@/server/runs/model";
import { CATEGORIES, type Category } from "@/server/scoring/model";
import type { Analysis, AnalysisEntry } from "./leaderboard";

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

/** Höchstens so viele Läufe im Kategorie-Diagramm (gruppierte Balken bleiben lesbar, Farben eindeutig). */
export const MAX_CATEGORY_RUNS = 4;
/** Ohne gültige Auswahl: die besten Läufe der Rangliste. */
const DEFAULT_CATEGORY_RUNS = 3;

export interface CategorySeries {
  runId: number;
  configuration: ConfigurationView;
  /** Score je Kategorie in der Reihenfolge von `categories`; `null`, wenn der Lauf die Kategorie nicht hat. */
  scores: (number | null)[];
}

export interface CategoryChart {
  /** Kategorien der Gold-Version in fester Reihenfolge (a–f) mit ihrer Zahl an Units. */
  categories: { category: Category; unitCount: number }[];
  /** Gewählte Läufe in der Reihenfolge der Auswahl (bestimmt die Farbe). */
  series: CategorySeries[];
}

/**
 * Score je Kategorie für ausgewählte Läufe. Wählbar sind nur Läufe der Rangliste (also unter denselben
 * Filtern); Unbekanntes, Doppeltes und Überzähliges entfällt, ohne gültige Auswahl gelten die besten Läufe.
 */
export function buildCategoryChart(entries: AnalysisEntry[], requested: readonly number[]): CategoryChart {
  const byId = new Map(entries.map((entry) => [entry.runId, entry]));
  let selected = [...new Set(requested)]
    .map((runId) => byId.get(runId))
    .filter((entry): entry is AnalysisEntry => entry !== undefined)
    .slice(0, MAX_CATEGORY_RUNS);
  if (selected.length === 0) selected = entries.slice(0, DEFAULT_CATEGORY_RUNS);

  const unitCounts = new Map<Category, number>();
  for (const entry of selected) {
    for (const { category, unitCount } of entry.evaluation.categories) {
      unitCounts.set(category, Math.max(unitCount, unitCounts.get(category) ?? 0));
    }
  }
  const categories = CATEGORIES.filter((category) => unitCounts.has(category)).map((category) => ({
    category,
    unitCount: unitCounts.get(category) ?? 0,
  }));
  const series = selected.map((entry) => {
    const scores = new Map(entry.evaluation.categories.map((item) => [item.category, item.score]));
    return {
      runId: entry.runId,
      configuration: entry.configuration,
      scores: categories.map(({ category }) => scores.get(category) ?? null),
    };
  });
  return { categories, series };
}

export interface ScoreHistoryPoint {
  runId: number;
  createdAt: Date;
  score: number;
  interval: { low: number; high: number } | null;
}

export interface ScoreHistory {
  /** Wählbar: die Konfigurationen der Rangliste in deren Reihenfolge, mit der Zahl ihrer Läufe. */
  configurations: { configuration: ConfigurationView; runCount: number }[];
  configuration: ConfigurationView | null;
  /** Alle auswertbaren Läufe der Konfiguration (gleiche Gruppe und Modus), ältester zuerst. */
  points: ScoreHistoryPoint[];
}

/**
 * Verlauf des Scores einer Konfiguration über das Laufdatum. Ohne gültige Auswahl die Konfiguration des
 * besten Laufs der Rangliste.
 */
export function buildScoreHistory(
  analysis: Pick<Analysis, "entries" | "scope">,
  requestedConfigurationId: number | null,
): ScoreHistory {
  const runsOf = (configurationId: number) =>
    analysis.scope.filter((entry) => entry.configuration.id === configurationId);
  // Wiederholte Läufe einer Konfiguration stehen mehrfach in der Rangliste; wählbar ist jede einmal.
  const unique = [
    ...new Map(analysis.entries.map(({ configuration }) => [configuration.id, configuration])).values(),
  ];
  const configurations = unique.map((configuration) => ({
    configuration,
    runCount: runsOf(configuration.id).length,
  }));
  const configuration =
    configurations.find((item) => item.configuration.id === requestedConfigurationId)?.configuration ??
    configurations[0]?.configuration ??
    null;
  const points = configuration
    ? runsOf(configuration.id)
        .map(({ runId, createdAt, score, interval }) => ({ runId, createdAt, score, interval }))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    : [];
  return { configurations, configuration, points };
}
