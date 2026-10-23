import { HARNESS_LABELS } from "@/server/harness/adapter";
import type { Configuration, RunProgress, RunStatus, UnitResultStatus } from "@/server/runs/model";

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "wartet auf Worker",
  running: "läuft",
  completed: "abgeschlossen",
  failed: "nicht ausführbar",
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
