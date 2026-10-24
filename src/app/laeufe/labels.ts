import { HARNESS_LABELS } from "@/server/harness/adapter";
import type { Configuration, RunProgress, RunStatus, UnitResultStatus } from "@/server/runs/model";
import type { Category, UnitEvaluationStatus, ViolationKind } from "@/server/scoring/model";

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "wartet auf Worker",
  running: "läuft",
  completed: "abgeschlossen",
  failed: "nicht ausführbar",
  cancelled: "abgebrochen",
};

export const UNIT_STATUS_LABELS: Record<UnitResultStatus, string> = {
  pending: "offen",
  running: "laufend",
  done: "fertig",
  failed: "fehlgeschlagen",
};

export const MODE_LABELS: Record<Configuration["mode"], string> = {
  text_only: "nur Zuständigkeitstext",
  web: "mit Websuche",
};

export function configurationLabel(configuration: Configuration): string {
  return `${HARNESS_LABELS[configuration.harness]} · ${configuration.model} · ${configuration.effort} · ${MODE_LABELS[configuration.mode]}`;
}

export function progressLabel(progress: RunProgress): string {
  return `${progress.done + progress.failed}/${progress.total}`;
}

export function formatDateTime(date: Date | null): string {
  return date ? date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" }) : "–";
}

export const VIOLATION_LABELS: Record<ViolationKind, string> = {
  evidence_not_verbatim: "Evidence nicht wörtlich",
  evidence_too_short: "Evidence kürzer als zwei Wörter",
  too_many_assignments: "zu viele Zuordnungen",
  broad_scope_without_reason: "Broad Scope ohne Begründung",
  recherche_without_web: "Recherche im Modus ohne Web",
  decision_contradiction: "Widerspruch decision/assignments",
  unknown_industry_id: "unbekannte industry_id",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  a: "a – breit",
  b: "b – eng",
  c: "c – no_mapping",
  d: "d – Committee-Kern/direkt",
  e: "e – name_only",
  f: "f – schwierige Zuordnung",
};

export const UNIT_EVALUATION_STATUS_LABELS: Record<UnitEvaluationStatus, string> = {
  answer: "Antwort",
  format_error: "Format-Fehler",
  failed: "Harness-Fehler",
  missing: "kein Ergebnis",
};

export function formatScore(value: number | null | undefined, digits = 3): string {
  return value === null || value === undefined ? "–" : value.toFixed(digits);
}

export function formatPercent(value: number | null): string {
  return value === null ? "–" : `${(value * 100).toFixed(1)} %`;
}
