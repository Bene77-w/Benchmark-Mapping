import { describe, expect, test } from "vitest";
import type { Analysis } from "./leaderboard";
import { analyse, PROMPT_B } from "./test-runs";
import { buildCategoryChart, buildHeatmap, buildScoreHistory, MAX_CATEGORY_RUNS } from "./views";

/**
 * Seam 2 – weitere Ansichten der Auswertung (Kategorien, Heatmap, Verlauf) aus derselben Aggregation wie
 * Rangliste und Scatter-Plot; dieselben Filter und Vergleichbarkeitsregeln.
 */

const UNITS = [{ unitId: "u1" }, { unitId: "u2" }, { unitId: "u3" }];

describe("Heatmap", () => {
  test("Zeilen sind die Läufe der Rangliste in ihrer Reihenfolge, Spalten die Gold-Units nach Kategorie", () => {
    const analysis = analyse([
      {
        id: 1,
        model: "m",
        score: 0.4,
        units: UNITS,
        unitEvaluations: { u1: { category: "c" }, u2: { category: "a" }, u3: { category: "a" } },
      },
      {
        id: 2,
        model: "n",
        score: 0.9,
        units: UNITS,
        unitEvaluations: { u1: { category: "c" }, u2: { category: "a" }, u3: { category: "a" } },
      },
    ]);
    const heatmap = buildHeatmap(analysis.entries);
    expect(heatmap.rows.map((row) => row.runId)).toEqual([2, 1]);
    expect(heatmap.units).toEqual([
      { unitId: "u2", category: "a" },
      { unitId: "u3", category: "a" },
      { unitId: "u1", category: "c" },
    ]);
    expect(heatmap.rows[0].cells.map((cell) => cell.unitId)).toEqual(["u2", "u3", "u1"]);
  });

  test("unterscheidet Format-Fehler und Harness-Fehler von Score 0 durch falsches Mapping", () => {
    const [row] = buildHeatmap(
      analyse([
        {
          id: 1,
          score: 0.25,
          units: [{ unitId: "u1" }, { unitId: "u2" }, { unitId: "u3" }, { unitId: "u4" }],
          unitEvaluations: {
            u1: { score: 1 },
            u2: { score: 0 },
            u3: { status: "format_error", errorKind: "invalid_json", score: 0 },
            u4: { status: "failed", errorKind: "rate_limit", score: 0 },
          },
        },
      ]).entries,
    ).rows;
    expect(row.cells).toEqual([
      { unitId: "u1", kind: "score", score: 1, errorKind: null },
      { unitId: "u2", kind: "score", score: 0, errorKind: null },
      { unitId: "u3", kind: "format_error", score: 0, errorKind: "invalid_json" },
      { unitId: "u4", kind: "harness_failure", score: 0, errorKind: "rate_limit" },
    ]);
  });

  test("ohne Läufe ist die Heatmap leer", () => {
    expect(buildHeatmap([])).toEqual({ units: [], rows: [] });
  });
});

describe("Score je Kategorie", () => {
  const categorized = (id: number, score: number, scores: [number, number, number]) => ({
    id,
    model: `m${id}`,
    score,
    units: UNITS,
    unitEvaluations: {
      u1: { category: "f" as const, score: scores[0] },
      u2: { category: "a" as const, score: scores[1] },
      u3: { category: "a" as const, score: scores[2] },
    },
  });
  const specs = [
    categorized(1, 0.5, [0, 1, 0.5]),
    categorized(2, 0.9, [1, 1, 0.7]),
    categorized(3, 0.7, [0.4, 0.8, 0.9]),
    categorized(4, 0.6, [0.2, 0.6, 1]),
    categorized(5, 0.3, [0, 0.5, 0.4]),
  ];

  test("ohne Auswahl die drei besten Läufe der Rangliste; Kategorien des Golds in fester Reihenfolge", () => {
    const chart = buildCategoryChart(analyse(specs).entries, []);
    expect(chart.categories).toEqual([
      { category: "a", unitCount: 2 },
      { category: "f", unitCount: 1 },
    ]);
    expect(chart.series.map((series) => series.runId)).toEqual([2, 3, 4]);
    expect(chart.series[0].scores).toEqual([0.85, 1]);
    expect(chart.series[1].scores.map((score) => score?.toFixed(2))).toEqual(["0.85", "0.40"]);
  });

  test("zeigt die gewählten Läufe in der Reihenfolge der Auswahl; Unbekanntes und Überzähliges entfällt", () => {
    const entries = analyse(specs).entries;
    expect(buildCategoryChart(entries, [5, 1]).series.map((series) => series.runId)).toEqual([5, 1]);
    expect(buildCategoryChart(entries, [99, 1, 1]).series.map((series) => series.runId)).toEqual([1]);
    expect(MAX_CATEGORY_RUNS).toBe(4);
    expect(buildCategoryChart(entries, [5, 4, 3, 2, 1]).series.map((series) => series.runId)).toEqual([
      5, 4, 3, 2,
    ]);
    // Gewählte Läufe, die die Filter ausblenden: zurück zum Standard.
    expect(buildCategoryChart(entries, [99]).series.map((series) => series.runId)).toEqual([2, 3, 4]);
    expect(buildCategoryChart([], [1]).series).toEqual([]);
  });
});

describe("Verlauf", () => {
  // Konfiguration m/high: drei Läufe (einer in anderer Gruppe, einer im Modus mit Web), m/low und n/high: je einer.
  const specs = [
    { id: 1, model: "m", effort: "high", score: 0.5, createdAt: "2026-10-20T10:00:00Z" },
    { id: 2, model: "m", effort: "high", score: 0.7, createdAt: "2026-10-22T10:00:00Z" },
    { id: 3, model: "m", effort: "high", score: 0.6, createdAt: "2026-10-21T10:00:00Z" },
    { id: 4, model: "m", effort: "low", score: 0.8, createdAt: "2026-10-21T12:00:00Z" },
    { id: 5, model: "n", effort: "high", score: 0.4, createdAt: "2026-10-21T13:00:00Z" },
    {
      id: 6,
      model: "m",
      effort: "high",
      score: 0.9,
      createdAt: "2026-10-19T10:00:00Z",
      promptHash: PROMPT_B,
    },
    {
      id: 7,
      model: "m",
      effort: "high",
      score: 0.9,
      createdAt: "2026-10-18T10:00:00Z",
      mode: "web" as const,
    },
  ];

  function configurationId(analysis: Analysis, model: string, effort: string): number {
    const entry = analysis.entries.find(
      ({ configuration }) => configuration.model === model && configuration.effort === effort,
    );
    if (!entry) throw new Error(`keine Konfiguration ${model}/${effort}`);
    return entry.configuration.id;
  }

  test("zeigt je Konfiguration alle Läufe der Gruppe und des Modus nach Datum, nicht nur den neuesten", () => {
    const analysis = analyse(specs);
    const mHigh = configurationId(analysis, "m", "high");
    const history = buildScoreHistory(analysis, mHigh);
    expect(history.configuration?.id).toBe(mHigh);
    expect(history.points.map((point) => [point.runId, point.score])).toEqual([
      [1, 0.5],
      [3, 0.6],
      [2, 0.7],
    ]);
    expect(history.points[0]).toMatchObject({
      createdAt: new Date("2026-10-20T10:00:00Z"),
      interval: { low: 0.4, high: 0.6 },
    });
  });

  test("wählbar sind die Konfigurationen der Rangliste; ohne gültige Auswahl die des besten Laufs", () => {
    const analysis = analyse(specs);
    const history = buildScoreHistory(analysis, null);
    expect(history.configurations.map((item) => [item.configuration.effort, item.runCount])).toEqual([
      ["low", 1],
      ["high", 3],
      ["high", 1],
    ]);
    expect(history.configuration).toMatchObject({ model: "m", effort: "low" });
    expect(history.points.map((point) => point.runId)).toEqual([4]);
    expect(buildScoreHistory(analysis, 999).configuration).toMatchObject({ effort: "low" });

    // „beste Stufe je Modell“: m/high steht nicht in der Rangliste und ist nicht wählbar.
    const best = buildScoreHistory(
      analyse(specs, { effort: "best" }),
      configurationId(analysis, "m", "high"),
    );
    expect(best.configurations.map((item) => item.configuration.model)).toEqual(["m", "n"]);
    expect(best.configuration).toMatchObject({ model: "m", effort: "low" });
  });

  test("ohne Läufe gibt es keinen Verlauf", () => {
    expect(buildScoreHistory(analyse([]), null)).toEqual({
      configurations: [],
      configuration: null,
      points: [],
    });
  });
});
