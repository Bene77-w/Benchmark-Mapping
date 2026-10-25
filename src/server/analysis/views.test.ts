import { describe, expect, test } from "vitest";
import { analyse } from "./test-runs";
import { buildHeatmap } from "./views";

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
