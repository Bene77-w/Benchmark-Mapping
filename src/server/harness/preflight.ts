import { z } from "zod";
import { MODES } from "@/server/prompt/benchmark-prompt";

/**
 * Preflight: Prüfungen eines Harness vor jedem Lauf (CLI erreichbar, Version, Modellname, Anmeldung,
 * Websuche bei Modus mit Web, …). Jeder Adapter liefert seine Prüfschritte; `runPreflight` führt sie der Reihe
 * nach aus. Nach dem ersten fehlgeschlagenen Schritt entfallen die übrigen (`skipped`), weil sie meist auf
 * dem vorigen aufbauen. Das Ergebnis wird am Lauf gespeichert; `ok == false` blockiert den Lauf.
 */

export const PREFLIGHT_STATUSES = ["ok", "warning", "failed", "skipped"] as const;
export type PreflightStatus = (typeof PREFLIGHT_STATUSES)[number];

export const preflightCheckSchema = z.object({
  /** Stabile ID der Prüfung, z. B. `cli`, `model`, `isolation`, `web_search`, `plan_type`. */
  id: z.string(),
  label: z.string(),
  status: z.enum(PREFLIGHT_STATUSES),
  message: z.string(),
});
export type PreflightCheck = z.infer<typeof preflightCheckSchema>;

export const preflightResultSchema = z.object({
  /** `false`, sobald eine Prüfung fehlgeschlagen ist; Warnungen blockieren nicht. */
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  cliVersion: z.string().nullable(),
  checks: z.array(preflightCheckSchema),
});
export type PreflightResult = z.infer<typeof preflightResultSchema>;

/** Was der Preflight prüft: die Konfiguration ohne Harness. */
export const preflightRequestSchema = z.object({
  model: z.string(),
  effort: z.string(),
  mode: z.enum(MODES),
});
export type PreflightRequest = z.infer<typeof preflightRequestSchema>;

export interface PreflightStep {
  id: string;
  label: string;
  run(): Promise<{ status: PreflightStatus; message: string }>;
}

export async function runPreflight(
  steps: PreflightStep[],
  getCliVersion: () => string | null,
  now: () => Date = () => new Date(),
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  let failed: PreflightCheck | null = null;
  for (const step of steps) {
    if (failed) {
      checks.push({
        id: step.id,
        label: step.label,
        status: "skipped",
        message: `nicht geprüft, weil „${failed.label}“ fehlgeschlagen ist`,
      });
      continue;
    }
    let outcome: Awaited<ReturnType<PreflightStep["run"]>>;
    try {
      outcome = await step.run();
    } catch (error) {
      outcome = { status: "failed", message: error instanceof Error ? error.message : String(error) };
    }
    const check = { id: step.id, label: step.label, ...outcome };
    checks.push(check);
    if (check.status === "failed") failed = check;
  }
  return { ok: failed === null, checkedAt: now().toISOString(), cliVersion: getCliVersion(), checks };
}

/** Kurzfassung der fehlgeschlagenen Prüfungen für die Fehlermeldung des Laufs. */
export function describePreflightFailure(result: PreflightResult): string {
  const failures = result.checks.filter((check) => check.status === "failed");
  return `Preflight fehlgeschlagen: ${failures.map((check) => `${check.label}: ${check.message}`).join("; ")}`;
}
