import type { HarnessErrorKind } from "@/server/harness/adapter";
import type { Mode } from "@/server/prompt/benchmark-prompt";
import type { UnitAnswer } from "@/server/prompt/output-schema";
import { isRecherche, isVerbatim, wordCount } from "./evidence";
import {
  BOOTSTRAP_CONFIDENCE,
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
}

/**
 * Vollständige Bewertung eines Laufs gegen eine Gold-Version (reine Funktion, deterministisch).
 *
 * Unit-Score: F1 aus Recall auf positiv und Präzision auf positiv ∪ vertretbar; no_mapping-Units 1 bei
 * no_mapping, sonst 0; ohne schemakonforme Antwort 0.
 */
export function evaluateRun(input: ScoringInput): RunEvaluation {
  const context: Context = {
    mode: input.mode,
    units: new Map(input.units.map((unit) => [unit.unitId, unit])),
  };
  const goldUnits = [...input.gold.units].sort((a, b) => compareIds(a.unitId, b.unitId));
  const units = goldUnits.map((goldUnit) =>
    evaluateUnit(goldUnit, input.outcomes.get(goldUnit.unitId), context),
  );
  const missingUnitIds = units.filter((unit) => unit.status === "missing").map((unit) => unit.unitId);
  const complete = missingUnitIds.length === 0;
  const scores = units.map((unit) => unit.score ?? 0);
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
    interval: null,
    bootstrap: {
      seed: input.seed ?? DEFAULT_BOOTSTRAP_SEED,
      samples: input.bootstrapSamples ?? DEFAULT_BOOTSTRAP_SAMPLES,
      confidence: BOOTSTRAP_CONFIDENCE,
    },
    formatErrors: units.filter((unit) => unit.status === "format_error").length,
    harnessFailures: units.filter((unit) => unit.status === "failed").length,
    violations,
    evidenceFidelity: checked === 0 ? null : verbatim / checked,
    categories: [],
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
    score: unitScore(gold, named, classes, positive),
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
  answer.assignments.forEach((entry, assignmentIndex) => {
    const add = (kind: ViolationKind) =>
      violations.push({ kind, assignmentIndex, industryId: entry.industry_id });
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

function effectiveClass(goldClass: GoldClass, webOnly: boolean, mode: Mode): GoldClass {
  return webOnly && mode === "text_only" ? "vertretbar" : goldClass;
}

function unitScore(
  gold: GoldUnit,
  named: string[],
  classes: ReadonlyMap<string, GoldClass>,
  positive: string[],
): number {
  if (gold.noMapping) return named.length === 0 ? 1 : 0;
  // Ohne Web sind alle positiven web_only-Industries vertretbar: no_mapping ist richtig, Nennungen zählen
  // nur über die Präzision.
  if (positive.length === 0) return named.length === 0 ? 1 : precisionOf(named, classes);
  if (named.length === 0) return 0;
  const recall = positive.filter((id) => named.includes(id)).length / positive.length;
  const precision = precisionOf(named, classes);
  return recall + precision === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function precisionOf(named: readonly string[], classes: ReadonlyMap<string, GoldClass>): number {
  return named.filter((id) => classes.has(id)).length / named.length;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sortierung nach Codepunkten (wie im Benchmark-Prompt), unabhängig von der Locale. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
