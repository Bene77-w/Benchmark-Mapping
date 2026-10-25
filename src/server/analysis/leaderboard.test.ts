import { describe, expect, test } from "vitest";
import { analysisSearch, parseAnalysisParams } from "./leaderboard";
import { analyse, PROMPT_A, PROMPT_B, type RunSpec, SNAPSHOT_A, SNAPSHOT_B, tokens } from "./test-runs";

/**
 * Seam 2 – Aggregation der Auswertung: auswertbare Läufe mit Bewertung + Preistabelle + Filter →
 * vergleichbare Gruppen, Rangliste und Punkte des Scatter-Plots samt effizientestem Bereich.
 */

describe("Rangliste", () => {
  test("ordnet die Läufe absteigend nach Score", () => {
    const analysis = analyse([
      { id: 1, model: "m", score: 0.5 },
      { id: 2, model: "n", score: 0.9 },
      { id: 3, model: "o", score: 0.7 },
    ]);
    expect(analysis.entries.map((entry) => entry.runId)).toEqual([2, 3, 1]);
    expect(analysis.entries[0]).toMatchObject({ score: 0.9, interval: { low: 0.8, high: 1 } });
  });

  test("weist geschätzte Kosten, Tokens und Dauer pro Unit sowie Format-Fehler und Regelverstöße aus", () => {
    const [entry] = analyse([
      {
        id: 1,
        score: 0.6,
        units: [
          { unitId: "u1", tokens: tokens(1000, 100), durationMs: 1000 },
          { unitId: "u2", tokens: tokens(3000, 300), durationMs: 3000 },
        ],
        formatErrors: 1,
        harnessFailures: 1,
        violations: { evidence_not_verbatim: 2, too_many_assignments: 1 },
      },
    ]).entries;
    // (1000 + 3000) × 1 $/M + (100 + 300) × 10 $/M = 0,008 $ für zwei Units
    expect(entry.costPerUnit).toEqual({ kind: "estimated", usd: 0.004 });
    expect(entry.tokensPerUnit).toBe(2200);
    expect(entry.durationPerUnitMs).toBe(2000);
    expect(entry).toMatchObject({ formatErrors: 1, harnessFailures: 1, violations: 3, unitCount: 2 });
  });

  test("zählt nur Units der Gold-Version: Antworten auf entfernte Units gehen nicht in die Kennzahlen ein", () => {
    const [entry] = analyse([
      {
        id: 1,
        score: 0.6,
        units: [
          { unitId: "u1", tokens: tokens(1000, 100), durationMs: 1000 },
          { unitId: "alt", tokens: tokens(100_000, 10_000), durationMs: 100_000 },
        ],
        goldUnitIds: ["u1"],
      },
    ]).entries;
    expect(entry.costPerUnit).toEqual({ kind: "estimated", usd: 0.002 });
    expect(entry.tokensPerUnit).toBe(1100);
    expect(entry.durationPerUnitMs).toBe(1000);
  });

  test("Kosten ohne Preis oder ohne Tokens sind unbekannt statt 0, Tokens und Dauer ohne Angabe ebenso", () => {
    const entries = analyse([
      { id: 1, model: "ohne-preis", score: 0.6 },
      {
        id: 2,
        score: 0.5,
        units: [
          { unitId: "u1", tokens: null, durationMs: null },
          { unitId: "u2", tokens: tokens(1000, 100), durationMs: 2000 },
        ],
      },
    ]).entries;
    expect(entries[0].costPerUnit).toMatchObject({
      kind: "unknown",
      reasons: ["kein Preis für Modell ohne-preis"],
    });
    expect(entries[0].tokensPerUnit).toBe(1100);
    expect(entries[1].costPerUnit).toMatchObject({ kind: "unknown", reasons: ["keine Tokens gemeldet"] });
    expect(entries[1].tokensPerUnit).toBeNull();
    expect(entries[1].durationPerUnitMs).toBeNull();
  });
});

describe("Vergleichbarkeit", () => {
  const specs: RunSpec[] = [
    { id: 1, score: 0.5, createdAt: "2026-10-20T10:00:00Z" },
    { id: 2, score: 0.6, createdAt: "2026-10-21T10:00:00Z", model: "n" },
    { id: 3, score: 0.9, createdAt: "2026-10-22T10:00:00Z", promptHash: PROMPT_B },
    { id: 4, score: 0.8, createdAt: "2026-10-23T10:00:00Z", snapshotHash: SNAPSHOT_B },
  ];

  test("teilt Läufe nach Prompt- und Snapshot-Hash in Gruppen; neueste Gruppe zuerst", () => {
    const { groups } = analyse(specs);
    expect(groups.map((group) => [group.promptHash, group.snapshotHash, group.runCount])).toEqual([
      [PROMPT_A, SNAPSHOT_B, 1],
      [PROMPT_B, SNAPSHOT_A, 1],
      [PROMPT_A, SNAPSHOT_A, 2],
    ]);
    expect(groups[0].promptVersion).toBe("prompt-v1");
    expect(new Set(groups.map((group) => group.key)).size).toBe(3);
  });

  test("trennt Hashes, die sich erst nach den ersten Zeichen unterscheiden", () => {
    const { groups } = analyse([
      { id: 1, score: 0.5, promptHash: PROMPT_A },
      { id: 2, score: 0.6, promptHash: `${"a".repeat(12)}${"f".repeat(52)}` },
      { id: 3, score: 0.7, snapshotHash: `${"5".repeat(12)}${"f".repeat(52)}` },
    ]);
    expect(groups.map((group) => group.runCount)).toEqual([1, 1, 1]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(3);
  });

  test("zeigt ohne Auswahl nur die Gruppe des neuesten Laufs, nie gemischt", () => {
    const analysis = analyse(specs);
    expect(analysis.filters.group).toBe(analysis.groups[0].key);
    expect(analysis.entries.map((entry) => entry.runId)).toEqual([4]);
  });

  test("zeigt die gewählte Gruppe; eine unbekannte Auswahl fällt auf die neueste zurück", () => {
    const { groups } = analyse(specs);
    const oldest = groups[2].key;
    expect(analyse(specs, { group: oldest }).entries.map((entry) => entry.runId)).toEqual([2, 1]);
    expect(analyse(specs, { group: "gibt-es-nicht" }).filters.group).toBe(groups[0].key);
  });

  test("ohne auswertbare Läufe gibt es keine Gruppe und keine Einträge", () => {
    const analysis = analyse([]);
    expect(analysis).toMatchObject({ groups: [], entries: [], filters: { group: null } });
  });
});

describe("Filter Modus und Effort", () => {
  test("zeigt nur einen Modus; ohne Auswahl den Modus ohne Web, sonst den vorhandenen", () => {
    const specs: RunSpec[] = [
      { id: 1, score: 0.5, mode: "text_only" },
      { id: 2, score: 0.9, mode: "web" },
    ];
    const standard = analyse(specs);
    expect(standard.modes).toEqual(["text_only", "web"]);
    expect(standard.filters.mode).toBe("text_only");
    expect(standard.entries.map((entry) => entry.runId)).toEqual([1]);
    expect(analyse(specs, { mode: "web" }).entries.map((entry) => entry.runId)).toEqual([2]);

    const nurWeb = analyse([{ id: 2, score: 0.9, mode: "web" }], { mode: "text_only" });
    expect(nurWeb.filters.mode).toBe("web");
    expect(nurWeb.entries.map((entry) => entry.runId)).toEqual([2]);
  });

  // Wiederholte Läufe der Konfiguration (m, high): der ältere ist besser als der neuere.
  const repeated: RunSpec[] = [
    { id: 1, score: 0.9, effort: "high", createdAt: "2026-10-20T10:00:00Z" },
    { id: 2, score: 0.4, effort: "high", createdAt: "2026-10-22T10:00:00Z" },
    { id: 3, score: 0.5, effort: "low", createdAt: "2026-10-21T10:00:00Z" },
  ];

  test("zeigt standardmäßig alle Läufe, auch wiederholte derselben Konfiguration", () => {
    const analysis = analyse(repeated);
    expect(analysis.filters.perConfiguration).toBe("all");
    expect(analysis.entries.map((entry) => entry.runId)).toEqual([1, 3, 2]);
  });

  test("„nur neueste je Konfiguration“ behält je Konfiguration den neuesten Lauf", () => {
    const analysis = analyse(repeated, { perConfiguration: "latest" });
    expect(analysis.filters.perConfiguration).toBe("latest");
    expect(analysis.entries.map((entry) => entry.runId)).toEqual([3, 2]);
    expect(analysis.efficient.tokens).toEqual([3]);
  });

  test("„nur beste je Konfiguration“ behält je Konfiguration den Lauf mit dem höchsten Score", () => {
    const analysis = analyse(repeated, { perConfiguration: "best" });
    expect(analysis.entries.map((entry) => entry.runId)).toEqual([1, 3]);
  });

  test("„beste Stufe je Modell“ betrachtet alle Läufe, auch ältere Wiederholungen", () => {
    for (const perConfiguration of ["all", "latest", "best"] as const) {
      const analysis = analyse(repeated, { effort: "best", perConfiguration });
      expect(analysis.entries.map((entry) => entry.runId)).toEqual([1]);
    }
  });

  test("der Verlauf umfasst unabhängig vom Umschalter alle Läufe des Modus", () => {
    expect(analyse(repeated, { perConfiguration: "latest" }).scope.map((entry) => entry.runId)).toEqual([
      2, 3, 1,
    ]);
  });

  test("„beste Stufe je Modell“ behält je Harness und Modell die Effort-Stufe mit dem höchsten Score", () => {
    const specs: RunSpec[] = [
      { id: 1, model: "m", effort: "low", score: 0.5 },
      { id: 2, model: "m", effort: "high", score: 0.7 },
      { id: 3, model: "m", effort: "xhigh", score: 0.6 },
      { id: 4, model: "n", effort: "low", score: 0.4 },
      { id: 5, harness: "codex", model: "m", effort: "low", score: 0.3 },
    ];
    expect(analyse(specs).entries.map((entry) => entry.runId)).toEqual([2, 3, 1, 4, 5]);
    const best = analyse(specs, { effort: "best" });
    expect(best.filters.effort).toBe("best");
    expect(best.entries.map((entry) => entry.runId)).toEqual([2, 4, 5]);
  });
});

describe("effizientester Bereich", () => {
  /** Je Lauf eine Unit; Kosten pro Unit = Input-Tokens × 1 $/M (Modell m, ohne Output). */
  function run(id: number, score: number, input: number, durationMs: number, model = "m"): RunSpec {
    return {
      id,
      model,
      effort: `e${id}`,
      score,
      units: [{ unitId: "u1", tokens: tokens(input, 0), durationMs }],
    };
  }

  test("markiert je x-Achse die Läufe, die kein anderer bei höchstens gleichem Aufwand im Score übertrifft", () => {
    const analysis = analyse([
      run(1, 0.5, 1000, 4000),
      run(2, 0.8, 2000, 1000),
      run(3, 0.7, 3000, 2000),
      run(4, 0.3, 500, 3000),
    ]);
    expect(analysis.efficient.cost).toEqual([4, 1, 2]);
    expect(analysis.efficient.tokens).toEqual([4, 1, 2]);
    expect(analysis.efficient.duration).toEqual([2]);
  });

  test("Läufe mit unbekannten Kosten liegen außerhalb der Kostenachse, auf den anderen Achsen zählen sie", () => {
    const analysis = analyse([run(1, 0.5, 1000, 2000), run(2, 0.9, 5000, 2000, "ohne-preis")]);
    expect(analysis.efficient.cost).toEqual([1]);
    expect(analysis.efficient.tokens).toEqual([1, 2]);
    expect(analysis.efficient.duration).toEqual([2]);
  });

  test("bei gleichem Aufwand und Score ist nur einer effizient", () => {
    const analysis = analyse([run(1, 0.5, 1000, 2000), run(2, 0.5, 1000, 2000)]);
    expect(analysis.efficient.cost).toHaveLength(1);
  });
});

describe("Filter aus der Adresse", () => {
  test("liest Gruppe, Modus, Effort und x-Achse; Unbekanntes wird zum Standard", () => {
    expect(parseAnalysisParams({ gruppe: "abc", modus: "web", effort: "beste", x: "dauer" })).toEqual({
      filters: { group: "abc", mode: "web", effort: "best", perConfiguration: "all" },
      xAxis: "duration",
      categoryRuns: [],
      historyConfiguration: null,
    });
    expect(parseAnalysisParams({ modus: "quatsch", effort: ["alle"], x: "tokens" })).toEqual({
      filters: { group: null, mode: null, effort: "all", perConfiguration: "all" },
      xAxis: "tokens",
      categoryRuns: [],
      historyConfiguration: null,
    });
    expect(parseAnalysisParams({})).toEqual({
      filters: { group: null, mode: null, effort: "all", perConfiguration: "all" },
      xAxis: "cost",
      categoryRuns: [],
      historyConfiguration: null,
    });
  });

  test("liest den Umschalter je Konfiguration; Unbekanntes heißt alle Läufe", () => {
    expect(parseAnalysisParams({ "je-konfiguration": "neueste" }).filters.perConfiguration).toBe("latest");
    expect(parseAnalysisParams({ "je-konfiguration": "beste" }).filters.perConfiguration).toBe("best");
    expect(parseAnalysisParams({ "je-konfiguration": "quatsch" }).filters.perConfiguration).toBe("all");
  });

  test("liest die Läufe des Kategorie-Diagramms und die Konfiguration des Verlaufs; Unlesbares entfällt", () => {
    expect(parseAnalysisParams({ laeufe: "7,3,x,-1,3.5", verlauf: "12" })).toMatchObject({
      categoryRuns: [7, 3],
      historyConfiguration: 12,
    });
    expect(parseAnalysisParams({ laeufe: "", verlauf: "abc" })).toMatchObject({
      categoryRuns: [],
      historyConfiguration: null,
    });
  });

  test("schreibt die Filter so in die Adresse, dass sie wieder gelesen werden", () => {
    const state = {
      filters: { group: "abc", mode: "web", effort: "best", perConfiguration: "all" },
      xAxis: "tokens",
      categoryRuns: [],
      historyConfiguration: null,
    } as const;
    const search = analysisSearch(state);
    expect(search).toBe("gruppe=abc&modus=web&effort=beste&x=tokens");
    expect(parseAnalysisParams(Object.fromEntries(new URLSearchParams(search)))).toEqual(state);

    const withViews = { ...state, categoryRuns: [7, 3], historyConfiguration: 12 };
    const viewSearch = analysisSearch(withViews);
    expect(viewSearch).toBe("gruppe=abc&modus=web&effort=beste&x=tokens&laeufe=7%2C3&verlauf=12");
    expect(parseAnalysisParams(Object.fromEntries(new URLSearchParams(viewSearch)))).toEqual(withViews);

    // Der Umschalter steht nur in der Adresse, wenn er gesetzt ist (Standard: alle Läufe).
    const latest = { ...state, filters: { ...state.filters, perConfiguration: "latest" } } as const;
    const latestSearch = analysisSearch(latest);
    expect(latestSearch).toBe("gruppe=abc&modus=web&effort=beste&je-konfiguration=neueste&x=tokens");
    expect(parseAnalysisParams(Object.fromEntries(new URLSearchParams(latestSearch)))).toEqual(latest);
  });
});
