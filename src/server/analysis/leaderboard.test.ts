import { describe, expect, test } from "vitest";
import type { TokenUsage } from "@/server/harness/adapter";
import type { PriceTable } from "@/server/pricing/cost";
import type { Mode } from "@/server/prompt/benchmark-prompt";
import type { RunView, UnitResultView } from "@/server/runs/model";
import { type RunEvaluation, VIOLATION_KINDS, type ViolationKind } from "@/server/scoring/model";
import { type AnalysisFilters, analysisSearch, buildAnalysis, parseAnalysisParams } from "./leaderboard";

/**
 * Seam 2 – Aggregation der Auswertung: auswertbare Läufe mit Bewertung + Preistabelle + Filter →
 * vergleichbare Gruppen, Rangliste und Punkte des Scatter-Plots samt effizientestem Bereich.
 */

const PROMPT_A = "a".repeat(64);
const PROMPT_B = "b".repeat(64);
const SNAPSHOT_A = "5".repeat(64);
const SNAPSHOT_B = "6".repeat(64);

interface RunSpec {
  id: number;
  harness?: RunView["configuration"]["harness"];
  model?: string;
  effort?: string;
  mode?: Mode;
  promptHash?: string;
  snapshotHash?: string;
  createdAt?: string;
  score: number;
  interval?: { low: number; high: number };
  formatErrors?: number;
  harnessFailures?: number;
  violations?: Partial<Record<ViolationKind, number>>;
  /** Units des Laufs; Standard: zwei Gold-Units mit je 1000 Input- und 100 Output-Tokens, 2 s Dauer. */
  units?: UnitSpec[];
  /** Gold-Units der Bewertung; Standard: die Units des Laufs. */
  goldUnitIds?: string[];
}

interface UnitSpec {
  unitId: string;
  tokens?: TokenUsage | null;
  durationMs?: number | null;
  webSearches?: number | null;
}

function tokens(input: number, output: number, cacheRead = 0, cacheWrite = 0): TokenUsage {
  return {
    inputTokens: input,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: null,
  };
}

const DEFAULT_UNITS: UnitSpec[] = [
  { unitId: "u1", tokens: tokens(1000, 100), durationMs: 2000 },
  { unitId: "u2", tokens: tokens(1000, 100), durationMs: 2000 },
];

function unitResult(spec: UnitSpec): UnitResultView {
  return {
    unitId: spec.unitId,
    status: "done",
    attempts: 1,
    unitPromptHash: null,
    answer: null,
    error: null,
    rawResponse: null,
    log: null,
    tokens: spec.tokens === undefined ? tokens(1000, 100) : spec.tokens,
    webSearches: spec.webSearches ?? 0,
    effort: null,
    nativeCostUsd: null,
    durationMs: spec.durationMs === undefined ? 2000 : spec.durationMs,
    exitCode: 0,
    cliVersion: null,
    modelReported: null,
    startedAt: null,
    finishedAt: null,
  };
}

function evaluated(spec: RunSpec): { run: RunView; evaluation: RunEvaluation } {
  const units = spec.units ?? DEFAULT_UNITS;
  const mode = spec.mode ?? "text_only";
  const createdAt = new Date(spec.createdAt ?? "2026-10-24T10:00:00Z");
  const violations = Object.fromEntries(VIOLATION_KINDS.map((kind) => [kind, 0])) as Record<
    ViolationKind,
    number
  >;
  Object.assign(violations, spec.violations);
  const goldUnitIds = spec.goldUnitIds ?? units.map((unit) => unit.unitId);
  const run: RunView = {
    id: spec.id,
    kind: "benchmark",
    status: "completed",
    error: null,
    configuration: {
      id: spec.id * 10,
      harness: spec.harness ?? "fake",
      model: spec.model ?? "m",
      effort: spec.effort ?? "high",
      mode,
    },
    snapshotId: 1,
    snapshotHash: spec.snapshotHash ?? SNAPSHOT_A,
    promptVersion: "prompt-v1",
    promptHash: spec.promptHash ?? PROMPT_A,
    outputSchemaVersion: "unit-answer-v1",
    outputSchemaHash: "c".repeat(64),
    parallelism: 3,
    timeoutMs: 60_000,
    preflight: null,
    createdAt,
    startedAt: createdAt,
    finishedAt: createdAt,
    rateLimitedUntil: null,
    progress: { total: units.length, pending: 0, running: 0, done: units.length, failed: 0 },
    units: units.map(unitResult),
  };
  const evaluation: RunEvaluation = {
    scoringVersion: "scoring-v1",
    goldVersion: "gold-v1",
    mode,
    complete: true,
    missingUnitIds: [],
    score: spec.score,
    interval: spec.interval ?? { low: spec.score - 0.1, high: spec.score + 0.1 },
    bootstrap: { seed: 1, samples: 10, confidence: 0.95 },
    formatErrors: spec.formatErrors ?? 0,
    harnessFailures: spec.harnessFailures ?? 0,
    violations,
    evidenceFidelity: null,
    categories: [],
    units: goldUnitIds.map((unitId) => ({
      unitId,
      category: "a",
      status: "answer",
      errorKind: null,
      score: spec.score,
      named: [],
      deviations: { matchedPositive: [], missingPositive: [], namedAcceptable: [], namedWrong: [] },
      violations: [],
      evidenceFidelity: null,
    })),
  } as RunEvaluation;
  return { run, evaluation };
}

/** 1 $ pro Million Input- und 10 $ pro Million Output-Tokens: Standard-Unit kostet 0,002 $. */
const PRICES: PriceTable = {
  models: {
    m: [{ validFrom: "2026-01-01", input: 1, cacheRead: null, cacheWrite: null, output: 10 }],
    n: [{ validFrom: "2026-01-01", input: 2, cacheRead: null, cacheWrite: null, output: 20 }],
  },
  webSearch: {},
};

const ALL: AnalysisFilters = { group: null, mode: null, effort: "all" };

function analyse(specs: RunSpec[], filters: Partial<AnalysisFilters> = {}) {
  return buildAnalysis({ runs: specs.map(evaluated), prices: PRICES, filters: { ...ALL, ...filters } });
}

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

  test("zeigt je Konfiguration nur ihren neuesten Lauf", () => {
    const entries = analyse([
      { id: 1, score: 0.9, effort: "high", createdAt: "2026-10-20T10:00:00Z" },
      { id: 2, score: 0.4, effort: "high", createdAt: "2026-10-22T10:00:00Z" },
      { id: 3, score: 0.5, effort: "low", createdAt: "2026-10-21T10:00:00Z" },
    ]).entries;
    expect(entries.map((entry) => entry.runId)).toEqual([3, 2]);
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
      filters: { group: "abc", mode: "web", effort: "best" },
      xAxis: "duration",
    });
    expect(parseAnalysisParams({ modus: "quatsch", effort: ["alle"], x: "tokens" })).toEqual({
      filters: { group: null, mode: null, effort: "all" },
      xAxis: "tokens",
    });
    expect(parseAnalysisParams({})).toEqual({
      filters: { group: null, mode: null, effort: "all" },
      xAxis: "cost",
    });
  });

  test("schreibt die Filter so in die Adresse, dass sie wieder gelesen werden", () => {
    const state = { filters: { group: "abc", mode: "web", effort: "best" }, xAxis: "tokens" } as const;
    const search = analysisSearch(state);
    expect(search).toBe("gruppe=abc&modus=web&effort=beste&x=tokens");
    expect(parseAnalysisParams(Object.fromEntries(new URLSearchParams(search)))).toEqual(state);
  });
});
