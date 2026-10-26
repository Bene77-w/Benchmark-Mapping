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

/**
 * Abbruch eines Preflights von außen: `signal` beendet laufende CLI-Aufrufe (der Adapter reicht es an jeden
 * Aufruf weiter), `shouldContinue` fragt vor jedem Schritt, ob er noch starten darf (der Runner prüft dort seinen
 * Claim). Nach einem Abbruch entfallen der Schritt und alle folgenden (`skipped`), das Ergebnis ist nicht `ok`.
 */
export interface PreflightOptions {
  signal?: AbortSignal;
  shouldContinue?: () => Promise<boolean>;
}

export async function runPreflight(
  steps: PreflightStep[],
  getCliVersion: () => string | null,
  options: PreflightOptions & { now?: () => Date } = {},
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  let failed: PreflightCheck | null = null;
  let aborted = false;
  for (const step of steps) {
    if (!failed && !aborted) {
      aborted =
        options.signal?.aborted === true ||
        (options.shouldContinue !== undefined && !(await options.shouldContinue()));
    }
    if (failed || aborted) {
      checks.push({
        id: step.id,
        label: step.label,
        status: "skipped",
        message: aborted
          ? "nicht geprüft, weil der Preflight abgebrochen wurde"
          : `nicht geprüft, weil „${failed?.label}“ fehlgeschlagen ist`,
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
  const now = options.now ?? (() => new Date());
  return {
    ok: failed === null && !aborted,
    checkedAt: now().toISOString(),
    cliVersion: getCliVersion(),
    checks,
  };
}

/** Kurzfassung der fehlgeschlagenen Prüfungen für die Fehlermeldung des Laufs. */
export function describePreflightFailure(result: PreflightResult): string {
  const failures = result.checks.filter((check) => check.status === "failed");
  return `Preflight fehlgeschlagen: ${failures.map((check) => `${check.label}: ${check.message}`).join("; ")}`;
}
