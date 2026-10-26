import { estimateRunCost, type PriceTable } from "@/server/pricing/cost";
import { MODES, type Mode } from "@/server/prompt/benchmark-prompt";
import type { ConfigurationView, RunView } from "@/server/runs/model";
import type { RunEvaluation } from "@/server/scoring/model";

export const EFFORT_FILTERS = ["all", "best"] as const;
/** `all` = jede Effort-Stufe; `best` = je Harness und Modell nur die Stufe mit dem höchsten Score. */
export type EffortFilter = (typeof EFFORT_FILTERS)[number];

export const PER_CONFIGURATION_FILTERS = ["all", "latest", "best"] as const;
/**
 * Wiederholte Läufe einer Konfiguration: `all` = alle (Standard), `latest` = nur der neueste, `best` = nur der
 * mit dem höchsten Score. Die beiden Einschränkungen schließen sich gegenseitig aus.
 */
export type PerConfigurationFilter = (typeof PER_CONFIGURATION_FILTERS)[number];

/**
 * Filter der Auswertungsseite (Rangliste, Scatter-Plot und weitere Ansichten): vergleichbare Gruppe
 * (Prompt- und Snapshot-Hash), Modus, Effort und Auswahl je Konfiguration. `null` = Standard wählen.
 */
export interface AnalysisFilters {
  group: string | null;
  mode: Mode | null;
  effort: EffortFilter;
  perConfiguration: PerConfigurationFilter;
}

export interface AnalysisInput {
  runs: { run: RunView; evaluation: RunEvaluation }[];
  prices: PriceTable;
  filters: AnalysisFilters;
}

export interface AnalysisEntry {
  runId: number;
  configuration: ConfigurationView;
  createdAt: Date;
  score: number;
  interval: { low: number; high: number } | null;
  /** Units der Gold-Version, über die die Kennzahlen pro Unit gemittelt sind. */
  unitCount: number;
  /** Geschätzte Kosten zum API-Listenpreis pro Unit; „unbekannt“, sobald eine Unit unbekannt ist (nie 0). */
  costPerUnit: CostPerUnit;
  /** Tokens (Input, Cache-Read, Cache-Write, Output) pro Unit; `null`, wenn eine Unit keine meldet. */
  tokensPerUnit: number | null;
  /** Dauer pro Unit in ms; `null`, wenn eine Unit keine Dauer hat. */
  durationPerUnitMs: number | null;
  formatErrors: number;
  harnessFailures: number;
  /** Summe aller Regelverstöße. */
  violations: number;
  /** Bewertung gegen die neueste Gold-Version (Kategorien, Unit-Scores für Heatmap und Kategorie-Diagramm). */
  evaluation: RunEvaluation;
}

export type CostPerUnit = { kind: "estimated"; usd: number } | { kind: "unknown"; reasons: string[] };

/** Umschaltbare x-Achse des Scatter-Plots: geschätzte Kosten, Tokens oder Dauer pro Unit. */
export const X_AXES = ["cost", "tokens", "duration"] as const;
export type XAxis = (typeof X_AXES)[number];

/** Wert eines Laufs auf der x-Achse; `null` = unbekannt (wird gekennzeichnet, nie als 0 gezeichnet). */
export function xValue(entry: AnalysisEntry, axis: XAxis): number | null {
  if (axis === "cost") return entry.costPerUnit.kind === "estimated" ? entry.costPerUnit.usd : null;
  if (axis === "tokens") return entry.tokensPerUnit;
  return entry.durationPerUnitMs;
}

/** Läufe mit gleichem Benchmark-Prompt- und Snapshot-Hash; nur sie sind miteinander vergleichbar. */
export interface ComparabilityGroup {
  key: string;
  promptVersion: string;
  promptHash: string;
  snapshotHash: string;
  runCount: number;
  latestAt: Date;
}

export interface Analysis {
  /** Vergleichbare Gruppen, die mit dem neuesten Lauf zuerst. */
  groups: ComparabilityGroup[];
  /** Tatsächlich angewandte Filter (ungültige oder fehlende Auswahl durch den Standard ersetzt). */
  filters: AnalysisFilters;
  /** Modi mit auswertbaren Läufen in der gewählten Gruppe. */
  modes: Mode[];
  /**
   * Rangliste, Punkte des Scatter-Plots und Zeilen der Heatmap: dieselben Läufe, absteigend nach Score.
   * Standardmäßig alle Läufe, auch wiederholte einer Konfiguration (siehe `PerConfigurationFilter`).
   */
  entries: AnalysisEntry[];
  /**
   * Effizientester Bereich je x-Achse: Läufe, die kein anderer bei höchstens gleichem Aufwand im Score
   * übertrifft (Pareto-Front), aufsteigend nach Aufwand. Läufe mit unbekanntem Wert gehören nie dazu.
   */
  efficient: Record<XAxis, number[]>;
  /**
   * Alle auswertbaren Läufe der gewählten Gruppe und des Modus, auch wiederholte Läufe einer Konfiguration
   * (unabhängig von den Filtern Effort und je Konfiguration), neueste zuerst; Grundlage des Verlaufs.
   */
  scope: AnalysisEntry[];
}

type EvaluatedRunView = AnalysisInput["runs"][number];

export function buildAnalysis(input: AnalysisInput): Analysis {
  const groups = comparabilityGroups(input.runs);
  const group = groups.find((candidate) => candidate.key === input.filters.group) ?? groups[0] ?? null;
  const inGroup = input.runs.filter(({ run }) => group !== null && groupKey(run) === group.key);
  const modes = MODES.filter((mode) => inGroup.some(({ run }) => run.configuration.mode === mode));
  const mode =
    input.filters.mode && modes.includes(input.filters.mode) ? input.filters.mode : (modes[0] ?? null);
  const inScope = inGroup.filter(({ run }) => run.configuration.mode === mode);

  const { effort, perConfiguration } = input.filters;
  const scope = inScope.map(({ run, evaluation }) => toEntry(run, evaluation, input.prices));
  // „Beste Stufe je Modell“ wählt aus allen Läufen (auch älteren Wiederholungen); sonst gilt die Auswahl je
  // Konfiguration.
  const entries = (
    effort === "best"
      ? bestPerModel(scope)
      : perConfiguration === "latest"
        ? latestPerConfiguration(scope)
        : perConfiguration === "best"
          ? bestPerConfiguration(scope)
          : [...scope]
  ).sort(byRank);
  scope.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    groups,
    filters: { group: group?.key ?? null, mode, effort, perConfiguration },
    modes,
    entries,
    efficient: {
      cost: paretoFront(entries, "cost"),
      tokens: paretoFront(entries, "tokens"),
      duration: paretoFront(entries, "duration"),
    },
    scope,
  };
}

function paretoFront(entries: AnalysisEntry[], axis: XAxis): number[] {
  const known = entries
    .map((entry) => ({ entry, x: xValue(entry, axis) }))
    .filter((point): point is { entry: AnalysisEntry; x: number } => point.x !== null)
    .sort((a, b) => a.x - b.x || b.entry.score - a.entry.score);
  const front: number[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const { entry } of known) {
    if (entry.score <= bestScore) continue;
    front.push(entry.runId);
    bestScore = entry.score;
  }
  return front;
}

/**
 * Höherer Score zuerst; bei Gleichstand der günstigere Lauf (bekannte Kosten vor unbekannten), dann der neuere.
 * Gilt für die Reihenfolge der Rangliste und für die Auswahl „nur beste“.
 */
function byRank(a: AnalysisEntry, b: AnalysisEntry): number {
  return (
    b.score - a.score ||
    compareCost(a.costPerUnit, b.costPerUnit) ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

function compareCost(a: CostPerUnit, b: CostPerUnit): number {
  if (a.kind === "estimated" && b.kind === "estimated") return a.usd - b.usd;
  if (a.kind === b.kind) return 0;
  return a.kind === "estimated" ? -1 : 1;
}

function pickPer(
  entries: AnalysisEntry[],
  keyOf: (configuration: ConfigurationView) => string,
  better: (a: AnalysisEntry, b: AnalysisEntry) => boolean,
) {
  const picked = new Map<string, AnalysisEntry>();
  for (const entry of entries) {
    const key = keyOf(entry.configuration);
    const current = picked.get(key);
    if (!current || better(entry, current)) picked.set(key, entry);
  }
  return [...picked.values()];
}

function configurationKey({ harness, model, effort, mode }: ConfigurationView): string {
  return JSON.stringify([harness, model, effort, mode]);
}

/** „Nur neueste je Konfiguration“: von wiederholten Läufen einer Konfiguration der neueste. */
function latestPerConfiguration(entries: AnalysisEntry[]): AnalysisEntry[] {
  return pickPer(entries, configurationKey, (a, b) => a.createdAt > b.createdAt);
}

/** „Nur beste je Konfiguration“: von wiederholten Läufen einer Konfiguration der beste nach `byRank`. */
function bestPerConfiguration(entries: AnalysisEntry[]): AnalysisEntry[] {
  return pickPer(entries, configurationKey, (a, b) => byRank(a, b) < 0);
}

/** „Beste Stufe je Modell“: je Harness und Modell der beste Lauf nach `byRank`. */
function bestPerModel(entries: AnalysisEntry[]): AnalysisEntry[] {
  return pickPer(
    entries,
    ({ harness, model }) => JSON.stringify([harness, model]),
    (a, b) => byRank(a, b) < 0,
  );
}

/** Schlüssel der Vergleichsgruppe: die vollständigen Hashes (ein Präfix könnte verschiedene Prompts vereinen). */
function groupKey(run: RunView): string {
  return `${run.promptHash}-${run.snapshotHash}`;
}

function comparabilityGroups(runs: EvaluatedRunView[]): ComparabilityGroup[] {
  const groups = new Map<string, ComparabilityGroup>();
  for (const { run } of runs) {
    const key = groupKey(run);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        key,
        promptVersion: run.promptVersion,
        promptHash: run.promptHash,
        snapshotHash: run.snapshotHash,
        runCount: 1,
        latestAt: run.createdAt,
      });
      continue;
    }
    group.runCount += 1;
    if (run.createdAt > group.latestAt) group.latestAt = run.createdAt;
  }
  return [...groups.values()].sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
}

/** Kennzahlen eines Laufs; gemittelt wird über die Units der Gold-Version (Antworten auf entfernte Units zählen nicht). */
function toEntry(run: RunView, evaluation: RunEvaluation, prices: PriceTable): AnalysisEntry {
  const goldUnitIds = new Set(evaluation.units.map((unit) => unit.unitId));
  const units = run.units.filter((unit) => goldUnitIds.has(unit.unitId));
  const unitCount = units.length;
  const cost = estimateRunCost({ ...run, units }, prices).estimated;
  return {
    runId: run.id,
    configuration: run.configuration,
    createdAt: run.createdAt,
    score: evaluation.score ?? 0,
    interval: evaluation.interval,
    unitCount,
    costPerUnit:
      cost.kind === "estimated"
        ? { kind: "estimated", usd: cost.usd / unitCount }
        : { kind: "unknown", reasons: cost.reasons },
    tokensPerUnit: meanOrNull(
      units.map((unit) =>
        unit.tokens
          ? unit.tokens.inputTokens +
            unit.tokens.cacheReadTokens +
            unit.tokens.cacheWriteTokens +
            unit.tokens.outputTokens
          : null,
      ),
    ),
    durationPerUnitMs: meanOrNull(units.map((unit) => unit.durationMs)),
    formatErrors: evaluation.formatErrors,
    harnessFailures: evaluation.harnessFailures,
    violations: Object.values(evaluation.violations).reduce((sum, count) => sum + count, 0),
    evaluation,
  };
}

function meanOrNull(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0) / values.length;
}

/** Zustand der Auswertungsseite, wie er in der Adresse steht. */
export interface AnalysisState {
  filters: AnalysisFilters;
  xAxis: XAxis;
  /** Gewählte Läufe des Kategorie-Diagramms (leer = Standard). */
  categoryRuns: readonly number[];
  /** Konfiguration des Verlaufs (`null` = Standard). */
  historyConfiguration: number | null;
}

type SearchParams = Record<string, string | string[] | undefined>;

const EFFORT_PARAMS: Record<EffortFilter, string> = { all: "alle", best: "beste" };
const PER_CONFIGURATION_PARAMS: Record<Exclude<PerConfigurationFilter, "all">, string> = {
  latest: "neueste",
  best: "beste",
};
const X_AXIS_PARAMS: Record<XAxis, string> = { cost: "kosten", tokens: "tokens", duration: "dauer" };

/**
 * Liest den Zustand aus den Suchparametern (`gruppe`, `modus`, `effort`, `je-konfiguration`, `x`, `laeufe`,
 * `verlauf`); Unbekanntes wird zum Standard.
 */
export function parseAnalysisParams(params: SearchParams): AnalysisState {
  const first = (name: string) => {
    const value = params[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const mode = first("modus");
  return {
    filters: {
      group: first("gruppe") || null,
      mode: MODES.find((candidate) => candidate === mode) ?? null,
      effort: keyOf(EFFORT_PARAMS, first("effort")) ?? "all",
      perConfiguration: keyOf(PER_CONFIGURATION_PARAMS, first("je-konfiguration")) ?? "all",
    },
    xAxis: keyOf(X_AXIS_PARAMS, first("x")) ?? "cost",
    categoryRuns: (first("laeufe") ?? "")
      .split(",")
      .map(positiveId)
      .filter((id) => id !== null),
    historyConfiguration: positiveId(first("verlauf") ?? ""),
  };
}

function positiveId(value: string): number | null {
  return /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

/** Suchparameter zum Zustand (Gegenstück zu `parseAnalysisParams`). */
export function analysisSearch(state: AnalysisState): string {
  const params = new URLSearchParams();
  if (state.filters.group) params.set("gruppe", state.filters.group);
  if (state.filters.mode) params.set("modus", state.filters.mode);
  params.set("effort", EFFORT_PARAMS[state.filters.effort]);
  const { perConfiguration } = state.filters;
  if (perConfiguration !== "all") params.set("je-konfiguration", PER_CONFIGURATION_PARAMS[perConfiguration]);
  params.set("x", X_AXIS_PARAMS[state.xAxis]);
  if (state.categoryRuns.length > 0) params.set("laeufe", state.categoryRuns.join(","));
  if (state.historyConfiguration !== null) params.set("verlauf", String(state.historyConfiguration));
  return params.toString();
}

function keyOf<K extends string>(map: Record<K, string>, value: string | undefined): K | undefined {
  return (Object.keys(map) as K[]).find((key) => map[key] === value);
}
