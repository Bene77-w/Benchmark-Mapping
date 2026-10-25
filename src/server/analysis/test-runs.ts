import type { TokenUsage } from "@/server/harness/adapter";
import type { PriceTable } from "@/server/pricing/cost";
import type { Mode } from "@/server/prompt/benchmark-prompt";
import type { RunView, UnitResultView } from "@/server/runs/model";
import {
  CATEGORIES,
  type Category,
  type RunEvaluation,
  type UnitEvaluation,
  VIOLATION_KINDS,
  type ViolationKind,
} from "@/server/scoring/model";
import { type AnalysisFilters, buildAnalysis } from "./leaderboard";

/** Baukasten der Tests der Auswertung (Seam 2): auswertbare Läufe samt Bewertung ohne Datenbank. */

export const PROMPT_A = "a".repeat(64);
export const PROMPT_B = "b".repeat(64);
export const SNAPSHOT_A = "5".repeat(64);
export const SNAPSHOT_B = "6".repeat(64);

export interface RunSpec {
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
  /** Bewertung je Gold-Unit; Standard: Kategorie a, Antwort mit dem Score des Laufs. */
  unitEvaluations?: Record<string, UnitEvaluationSpec>;
}

export interface UnitSpec {
  unitId: string;
  tokens?: TokenUsage | null;
  durationMs?: number | null;
  webSearches?: number | null;
}

export interface UnitEvaluationSpec {
  category?: Category;
  status?: UnitEvaluation["status"];
  errorKind?: UnitEvaluation["errorKind"];
  score?: number | null;
}

export function tokens(input: number, output: number, cacheRead = 0, cacheWrite = 0): TokenUsage {
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

export function evaluated(spec: RunSpec): { run: RunView; evaluation: RunEvaluation } {
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
  const unitEvaluations: UnitEvaluation[] = goldUnitIds.map((unitId) => {
    const unit = spec.unitEvaluations?.[unitId] ?? {};
    return {
      unitId,
      category: unit.category ?? "a",
      status: unit.status ?? "answer",
      errorKind: unit.errorKind ?? null,
      score: unit.score === undefined ? spec.score : unit.score,
      named: [],
      deviations: { matchedPositive: [], missingPositive: [], namedAcceptable: [], namedWrong: [] },
      violations: [],
      evidence: { checked: 0, verbatim: 0 },
    };
  });
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
    categories: CATEGORIES.flatMap((category) => {
      const ofCategory = unitEvaluations.filter((unit) => unit.category === category);
      if (ofCategory.length === 0) return [];
      const sum = ofCategory.reduce((total, unit) => total + (unit.score ?? 0), 0);
      return [{ category, unitCount: ofCategory.length, score: sum / ofCategory.length }];
    }),
    units: unitEvaluations,
  };
  return { run, evaluation };
}

/** 1 $ pro Million Input- und 10 $ pro Million Output-Tokens: Standard-Unit kostet 0,002 $. */
export const PRICES: PriceTable = {
  models: {
    m: [{ validFrom: "2026-01-01", input: 1, cacheRead: null, cacheWrite: null, output: 10 }],
    n: [{ validFrom: "2026-01-01", input: 2, cacheRead: null, cacheWrite: null, output: 20 }],
  },
  webSearch: {},
};

const ALL: AnalysisFilters = { group: null, mode: null, effort: "all" };

export function analyse(specs: RunSpec[], filters: Partial<AnalysisFilters> = {}) {
  return buildAnalysis({ runs: specs.map(evaluated), prices: PRICES, filters: { ...ALL, ...filters } });
}
