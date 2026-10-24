import type { HarnessErrorKind } from "@/server/harness/adapter";
import type { Mode } from "@/server/prompt/benchmark-prompt";
import type { UnitAnswer } from "@/server/prompt/output-schema";
import type { InputBasis, UnitKind } from "@/server/snapshot/model";

/**
 * Begriffe der Bewertung (GLOSSARY.md „Bewertung“ und „Gold“). Ergebnisse sind reines JSON, damit sie je
 * (Lauf, Gold-Version) unverändert gespeichert werden können.
 */

/** Version der Bewertungsregeln; eine Änderung der Regeln erzwingt die Neubewertung gespeicherter Läufe. */
export const SCORING_VERSION = "scoring-v1";

/** Kategorien des Gold-Sets: a breit, b eng, c no_mapping, d Committee-Kern/direkt, e name_only, f schwierig. */
export const CATEGORIES = ["a", "b", "c", "d", "e", "f"] as const;
export type Category = (typeof CATEGORIES)[number];

export const GOLD_CLASSES = ["positiv", "vertretbar"] as const;
export type GoldClass = (typeof GOLD_CLASSES)[number];

export interface GoldIndustry {
  industryId: string;
  class: GoldClass;
  /** Nur über Recherche belegbar; im Modus ohne Web zählt die Industry als vertretbar. */
  webOnly: boolean;
}

export interface GoldUnit {
  unitId: string;
  category: Category;
  /** Richtige Antwort ist no_mapping; dann gibt es keine Gold-Industries. */
  noMapping: boolean;
  industries: GoldIndustry[];
}

export interface GoldVersion {
  /** z. B. `gold-v1`; Schlüssel der gespeicherten Bewertung zusammen mit dem Lauf. */
  version: string;
  units: GoldUnit[];
}

/** Ergebnis eines Laufs für eine Unit: schemakonforme Antwort oder Fehlerart. Fehlt die Unit, gibt es noch keins. */
export type UnitOutcome =
  | { kind: "answer"; answer: UnitAnswer }
  | { kind: "failed"; errorKind: HarnessErrorKind };

/** Was die Bewertung über eine Unit aus dem Snapshot braucht: Evidence-Quellen und Grenzen der Anzahl. */
export interface ScoringUnit {
  unitId: string;
  unitName: string;
  kind: UnitKind;
  inputBasis: InputBasis;
  jurisdictionText: string | null;
}

export interface ScoringInput {
  mode: Mode;
  gold: GoldVersion;
  /** Unit-Ergebnisse des Laufs; Ergebnisse zu Units außerhalb des Golds gehen nicht in den Score ein. */
  outcomes: ReadonlyMap<string, UnitOutcome>;
  /** Units des Snapshots (mindestens die des Golds). */
  units: readonly ScoringUnit[];
  /** industry_ids der Taxonomie des Snapshots. */
  industryIds: readonly string[];
  /** Startwert des Bootstrap-Zufallsgenerators; Standard `DEFAULT_BOOTSTRAP_SEED`. */
  seed?: number;
  /** Zahl der Bootstrap-Stichproben; Standard `DEFAULT_BOOTSTRAP_SAMPLES`. */
  bootstrapSamples?: number;
}

export const DEFAULT_BOOTSTRAP_SEED = 20261023;
export const DEFAULT_BOOTSTRAP_SAMPLES = 2000;
/** Konfidenzniveau des Bootstrap-Intervalls (Perzentilmethode). */
export const BOOTSTRAP_CONFIDENCE = 0.95;

/** Arten von Regelverstößen; jede wird je Lauf einzeln gezählt. */
export const VIOLATION_KINDS = [
  "evidence_not_verbatim",
  "evidence_too_short",
  "too_many_assignments",
  "broad_scope_without_reason",
  "recherche_without_web",
  "decision_contradiction",
  "unknown_industry_id",
] as const;
export type ViolationKind = (typeof VIOLATION_KINDS)[number];

export interface Violation {
  kind: ViolationKind;
  /** Position der betroffenen Zuordnung in `assignments`; `null` bei Verstößen der ganzen Antwort. */
  assignmentIndex: number | null;
  industryId: string | null;
}

/** answer = schemakonforme Antwort; format_error = Timeout, ungültiges JSON, Schemaverstoß; failed = sonstiger Harness-Fehler; missing = noch kein Ergebnis. */
export type UnitEvaluationStatus = "answer" | "format_error" | "failed" | "missing";

export interface UnitEvaluation {
  unitId: string;
  category: Category;
  status: UnitEvaluationStatus;
  errorKind: HarnessErrorKind | null;
  /** Unit-Score 0–1; `null` nur, wenn das Ergebnis fehlt. */
  score: number | null;
  /** Industries, die die Antwort nennt (ohne Doppelte, in Antwortreihenfolge); leer bei no_mapping. */
  named: string[];
  /** Abweichungen gegen das Gold mit den im Modus geltenden Klassen (web_only ohne Web = vertretbar). */
  deviations: {
    matchedPositive: string[];
    missingPositive: string[];
    namedAcceptable: string[];
    namedWrong: string[];
  };
  violations: Violation[];
  /** Geprüfte Zitate (ohne `Recherche`) und davon wörtliche. */
  evidence: { checked: number; verbatim: number };
}

export interface CategoryScore {
  category: Category;
  unitCount: number;
  /** Mittelwert der Unit-Scores der Kategorie; `null`, solange der Lauf unvollständig ist. */
  score: number | null;
}

export interface RunEvaluation {
  scoringVersion: string;
  goldVersion: string;
  mode: Mode;
  /** Jede Unit des Golds hat ein Ergebnis. Sonst sind Score, Intervall und Kategorien `null`. */
  complete: boolean;
  missingUnitIds: string[];
  score: number | null;
  interval: { low: number; high: number } | null;
  bootstrap: { seed: number; samples: number; confidence: number };
  formatErrors: number;
  /** Units ohne Antwort wegen eines Harness-Fehlers oder Ratenlimits (Score 0, kein Format-Fehler). */
  harnessFailures: number;
  violations: Record<ViolationKind, number>;
  /** Anteil wörtlicher Zitate an allen geprüften Zitaten; `null` ohne geprüftes Zitat. */
  evidenceFidelity: number | null;
  categories: CategoryScore[];
  /** Je Gold-Unit, sortiert nach unit_id. */
  units: UnitEvaluation[];
}
