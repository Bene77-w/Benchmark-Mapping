import type { HarnessErrorKind } from "@/server/harness/adapter";
import type { Mode } from "@/server/prompt/benchmark-prompt";
import type { UnitAnswer } from "@/server/prompt/output-schema";
import { isRecherche, isVerbatim, wordCount } from "./evidence";
import {
  BOOTSTRAP_CONFIDENCE,
  CATEGORIES,
  type CategoryScore,
  DEFAULT_BOOTSTRAP_SAMPLES,
  DEFAULT_BOOTSTRAP_SEED,
  type GoldClass,
  type GoldUnit,
  type RunEvaluation,
  SCORING_VERSION,
  type ScoringInput,
  type ScoringUnit,
  type UnitEvaluation,
  type UnitOutcome,
  VIOLATION_KINDS,
  type Violation,
  type ViolationKind,
} from "./model";

interface Context {
  mode: Mode;
  units: ReadonlyMap<string, ScoringUnit>;
  industryIds: ReadonlySet<string>;
}

/** Normalfall höchstens 2 Zuordnungen; 3 bis 5 nur mit Broad-Scope-Ausnahme, nie mehr als 5. */
const NORMAL_LIMIT = 2;
const BROAD_SCOPE_LIMIT = 5;

/**
 * Vollständige Bewertung eines Laufs gegen eine Gold-Version (reine Funktion, deterministisch).
 *
 * Unit-Score: F1 aus Recall auf positiv und Präzision auf positiv ∪ vertretbar; no_mapping-Units 1 bei
 * `decision: "no_mapping"`, sonst 0; ohne schemakonforme Antwort 0. Maßgeblich ist `decision`: Zuordnungen
 * zählen nur bei `mapped`; `mapped` ohne Zuordnung ist kein no_mapping (Widerspruch, keine Industry genannt).
 */
export function evaluateRun(input: ScoringInput): RunEvaluation {
  const context: Context = {
    mode: input.mode,
    units: new Map(input.units.map((unit) => [unit.unitId, unit])),
    industryIds: new Set(input.industryIds),
  };
  const goldUnits = [...input.gold.units].sort((a, b) => compareIds(a.unitId, b.unitId));
  const units = goldUnits.map((goldUnit) =>
    evaluateUnit(goldUnit, input.outcomes.get(goldUnit.unitId), context),
  );
  const missingUnitIds = units.filter((unit) => unit.status === "missing").map((unit) => unit.unitId);
  const complete = missingUnitIds.length === 0;
  const scores = units.map((unit) => unit.score ?? 0);
  const seed = input.seed ?? DEFAULT_BOOTSTRAP_SEED;
  const samples = input.bootstrapSamples ?? DEFAULT_BOOTSTRAP_SAMPLES;
  const violations = Object.fromEntries(VIOLATION_KINDS.map((kind) => [kind, 0])) as Record<
    ViolationKind,
    number
  >;
  for (const violation of units.flatMap((unit) => unit.violations)) violations[violation.kind] += 1;
  const checked = units.reduce((sum, unit) => sum + unit.evidence.checked, 0);
  const verbatim = units.reduce((sum, unit) => sum + unit.evidence.verbatim, 0);
  return {
    scoringVersion: SCORING_VERSION,
    goldVersion: input.gold.version,
    mode: input.mode,
    complete,
    missingUnitIds,
    score: complete ? mean(scores) : null,
    interval: complete && scores.length > 0 ? bootstrapInterval(scores, seed, samples) : null,
    bootstrap: { seed, samples, confidence: BOOTSTRAP_CONFIDENCE },
    formatErrors: units.filter((unit) => unit.status === "format_error").length,
    harnessFailures: units.filter((unit) => unit.status === "failed").length,
    violations,
    evidenceFidelity: checked === 0 ? null : verbatim / checked,
    categories: categoryScores(units, complete),
    units,
  };
}

const FORMAT_ERROR_KINDS: readonly HarnessErrorKind[] = ["invalid_json", "schema_violation", "timeout"];

function evaluateUnit(gold: GoldUnit, outcome: UnitOutcome | undefined, context: Context): UnitEvaluation {
  const { mode } = context;
  const base = {
    unitId: gold.unitId,
    category: gold.category,
    named: [] as string[],
    deviations: { matchedPositive: [], missingPositive: [], namedAcceptable: [], namedWrong: [] },
    violations: [],
    evidence: { checked: 0, verbatim: 0 },
  };
  if (!outcome) return { ...base, status: "missing", errorKind: null, score: null };
  if (outcome.kind === "failed") {
    const status = FORMAT_ERROR_KINDS.includes(outcome.errorKind) ? "format_error" : "failed";
    return { ...base, status, errorKind: outcome.errorKind, score: 0 };
  }
  const { answer } = outcome;
  const named = [
    ...new Set(answer.decision === "mapped" ? answer.assignments.map((entry) => entry.industry_id) : []),
  ];
  const classes = new Map<string, GoldClass>(
    gold.industries.map((entry) => [entry.industryId, effectiveClass(entry.class, entry.webOnly, mode)]),
  );
  const positive = [...classes].filter(([, value]) => value === "positiv").map(([id]) => id);
  return {
    ...base,
    status: "answer",
    errorKind: null,
    named,
    deviations: {
      matchedPositive: positive.filter((id) => named.includes(id)),
      missingPositive: positive.filter((id) => !named.includes(id)),
      namedAcceptable: named.filter((id) => classes.get(id) === "vertretbar"),
      namedWrong: named.filter((id) => !classes.has(id)),
    },
    score: unitScore(gold, answer.decision, named, classes, positive),
    ...checkRules(answer, sourceUnit(gold.unitId, context), context),
  };
}

function sourceUnit(unitId: string, context: Context): ScoringUnit {
  const unit = context.units.get(unitId);
  if (!unit) throw new Error(`Unit ${unitId} des Golds fehlt im Snapshot`);
  return unit;
}

/** Regelverstöße einer schemakonformen Antwort und die Zahl wörtlicher Zitate. */
function checkRules(
  answer: UnitAnswer,
  unit: ScoringUnit,
  context: Context,
): Pick<UnitEvaluation, "violations" | "evidence"> {
  const violations: Violation[] = [];
  const evidence = { checked: 0, verbatim: 0 };
  const count = answer.assignments.length;
  const addForAnswer = (kind: ViolationKind) =>
    violations.push({ kind, assignmentIndex: null, industryId: null });
  if ((answer.decision === "mapped") !== count > 0) addForAnswer("decision_contradiction");
  if (count > assignmentLimit(answer, unit)) addForAnswer("too_many_assignments");
  if (answer.broad_scope_exception && !answer.broad_scope_reason?.trim()) {
    addForAnswer("broad_scope_without_reason");
  }
  answer.assignments.forEach((entry, assignmentIndex) => {
    const add = (kind: ViolationKind) =>
      violations.push({ kind, assignmentIndex, industryId: entry.industry_id });
    if (!context.industryIds.has(entry.industry_id)) add("unknown_industry_id");
    if (isRecherche(entry.evidence_excerpt)) {
      if (context.mode !== "web") add("recherche_without_web");
      return;
    }
    evidence.checked += 1;
    if (isVerbatim(entry.evidence_excerpt, [unit.unitName, unit.jurisdictionText])) evidence.verbatim += 1;
    else add("evidence_not_verbatim");
    if (wordCount(entry.evidence_excerpt) < 2) add("evidence_too_short");
  });
  return { violations, evidence };
}

/** committee_parent_core und name_only: höchstens 2, auch mit Broad-Scope-Ausnahme. */
function assignmentLimit(answer: UnitAnswer, unit: ScoringUnit): number {
  if (unit.kind === "committee_parent_core" || unit.inputBasis === "name_only") return NORMAL_LIMIT;
  return answer.broad_scope_exception ? BROAD_SCOPE_LIMIT : NORMAL_LIMIT;
}

function effectiveClass(goldClass: GoldClass, webOnly: boolean, mode: Mode): GoldClass {
  return webOnly && mode === "text_only" ? "vertretbar" : goldClass;
}

function unitScore(
  gold: GoldUnit,
  decision: UnitAnswer["decision"],
  named: string[],
  classes: ReadonlyMap<string, GoldClass>,
  positive: string[],
): number {
  const saysNoMapping = decision === "no_mapping";
  if (gold.noMapping) return saysNoMapping ? 1 : 0;
  // Ohne Web sind alle positiven web_only-Industries vertretbar: no_mapping ist richtig, Nennungen zählen
  // nur über die Präzision.
  if (positive.length === 0) {
    if (saysNoMapping) return 1;
    return named.length === 0 ? 0 : precisionOf(named, classes);
  }
  if (named.length === 0) return 0;
  const recall = positive.filter((id) => named.includes(id)).length / positive.length;
  const precision = precisionOf(named, classes);
  return recall + precision === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function precisionOf(named: readonly string[], classes: ReadonlyMap<string, GoldClass>): number {
  return named.filter((id) => classes.has(id)).length / named.length;
}

function categoryScores(units: readonly UnitEvaluation[], complete: boolean): CategoryScore[] {
  return CATEGORIES.flatMap((category) => {
    const ofCategory = units.filter((unit) => unit.category === category);
    if (ofCategory.length === 0) return [];
    const score = complete ? mean(ofCategory.map((unit) => unit.score ?? 0)) : null;
    return [{ category, unitCount: ofCategory.length, score }];
  });
}

/**
 * Perzentil-Bootstrap über die Units: `samples`-mal n Unit-Scores mit Zurücklegen ziehen, Mittelwerte
 * sortieren, das zentrale Konfidenzintervall ablesen (lineare Interpolation). Mit festem Seed reproduzierbar;
 * die Reihenfolge der Scores folgt den sortierten unit_ids.
 */
function bootstrapInterval(
  scores: readonly number[],
  seed: number,
  samples: number,
): { low: number; high: number } {
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let sum = 0;
    for (let draw = 0; draw < scores.length; draw += 1) {
      sum += scores[Math.floor(random() * scores.length)];
    }
    means.push(sum / scores.length);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - BOOTSTRAP_CONFIDENCE) / 2;
  return { low: quantile(means, tail), high: quantile(means, 1 - tail) };
}

function quantile(sorted: readonly number[], q: number): number {
  const position = q * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Kleiner, deterministischer 32-Bit-Zufallsgenerator (Mulberry32); Werte in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sortierung nach Codepunkten (wie im Benchmark-Prompt), unabhängig von der Locale. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
