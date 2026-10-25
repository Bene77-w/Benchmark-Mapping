import type { Mode } from "@/server/prompt/benchmark-prompt";
import { type JsonSchema, type UnitAnswer, unitAnswerSchema } from "@/server/prompt/output-schema";
import type { PreflightRequest, PreflightResult } from "./preflight";

/**
 * Harness-Adapter: die gemeinsame Schnittstelle, über die der Runner eine Unit an eine Agent-CLI schickt.
 * Aufgabe rein, Ergebnis raus. Jeder Adapter (Claude Code, Codex, OpenCode, Fake) übersetzt nur zwischen
 * dieser Schnittstelle und seiner CLI; Wiederholversuch, Warten bei Ratenlimit und Bewertung sind nicht
 * Sache des Adapters.
 */

export const HARNESSES = ["claude_code", "codex", "opencode", "fake"] as const;
export type Harness = (typeof HARNESSES)[number];

export const HARNESS_LABELS: Record<Harness, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  fake: "Fake (Test)",
};

/** Eine Unit, wie sie an den Harness geht. */
export interface HarnessTask {
  unitId: string;
  systemPrompt: string;
  userPrompt: string;
  /** Ausgabeschema als JSON-Schema (`--json-schema`, `--output-schema`, bei OpenCode im Prompt). */
  outputSchema: JsonSchema;
  /**
   * Formatierungsauftrag der Prompt-Version (`format-instruction.md`) für Adapter, die das Schema im
   * System-Prompt mitschicken (`inlinesOutputSchema`); andere Adapter ignorieren ihn.
   */
  formatInstruction?: string;
  /** Modell-ID wie im Harness (Freitext). */
  model: string;
  /** Effort-Stufe wie im Harness (Freitext). */
  effort: string;
  mode: Mode;
  /** Höchstdauer des Aufrufs; der Adapter bricht danach ab und meldet `timeout`. */
  timeoutMs: number;
  /**
   * Optionaler Abbruch: echte Adapter beenden dann den CLI-Prozess und melden `harness_error`. Der Runner
   * entscheidet, ob er ihn setzt (bisher nicht: laufende Units werden beim Abbruch zu Ende geführt).
   */
  signal?: AbortSignal;
}

/**
 * Tokens eines Aufrufs je Kategorie. `inputTokens` sind die nicht gecachten Input-Tokens (ohne Cache-Read
 * und Cache-Write); `outputTokens` enthalten die Reasoning-Tokens, `reasoningTokens` weist sie, falls der
 * Harness sie meldet, nur zusätzlich aus.
 */
export interface TokenUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
}

/**
 * Tokens je Modell-ID laut Harness, wenn ein Aufruf mehrere Modelle nutzt (Claude Code: `modelUsage`, etwa
 * ein Hilfsmodell neben dem Hauptmodell). Die Summe steht zusätzlich in `tokens`.
 */
export type TokensByModel = Record<string, TokenUsage>;

/** Fehlerarten eines Aufrufs; `invalid_json` und `schema_violation` sind Format-Fehler. */
export const HARNESS_ERROR_KINDS = [
  "invalid_json",
  "schema_violation",
  "timeout",
  "rate_limit",
  "harness_error",
] as const;
export type HarnessErrorKind = (typeof HARNESS_ERROR_KINDS)[number];

/** Antwort oder Fehlerart. Ein Ratenlimit ist eine eigene Fehlerart, ggf. mit Zeitpunkt der Freigabe. */
export type HarnessOutcome =
  | { kind: "answer"; answer: UnitAnswer }
  | { kind: Exclude<HarnessErrorKind, "rate_limit">; message: string }
  | { kind: "rate_limit"; message: string; resetAt: Date | null };

export interface HarnessResult {
  outcome: HarnessOutcome;
  /** Antworttext des Modells, wie er aus der CLI kam (`null`, wenn es keinen gab). */
  rawResponse: string | null;
  /** Rohprotokoll des Aufrufs (Events, stdout/stderr). */
  log: string;
  /** `null`, wenn der Harness keine Tokens gemeldet hat. */
  tokens: TokenUsage | null;
  /** Tokens je Modell (nur Harnesses, die sie getrennt melden); die Kostenschätzung bepreist sie einzeln. */
  tokensByModel?: TokensByModel | null;
  /** Zahl der Websuchen; `null`, wenn unbekannt. */
  webSearches: number | null;
  /**
   * Vermerke, die das Ergebnis nicht ungültig machen, aber sichtbar bleiben sollen (z. B. eine nicht
   * gelöschte OpenCode-Sitzung); die GUI zeigt sie an der Unit.
   */
  warnings?: string[];
  /** Effort laut Harness; `confirmed` nur, wenn der Harness die angeforderte Stufe selbst gemeldet hat. */
  effort: { reported: string | null; confirmed: boolean };
  /** Native Kostenangabe des Harness in USD zur Gegenprobe (`null`, wenn keine). */
  nativeCostUsd: number | null;
  durationMs: number;
  exitCode: number | null;
  cliVersion: string | null;
  /** Modell laut Harness. */
  modelReported: string | null;
}

export interface HarnessAdapter {
  readonly harness: Harness;
  run(task: HarnessTask): Promise<HarnessResult>;
  /**
   * Der Harness kennt keine Schema-Option: der Adapter hängt Formatierungsauftrag und Schema an den
   * System-Prompt (`withInlineSchema`), und der Runner bildet den Unit-Hash über genau diesen Text.
   */
  readonly inlinesOutputSchema?: boolean;
  /**
   * Prüft vor einem Lauf, ob die Konfiguration ausführbar ist (siehe preflight.ts). Der Runner speichert das
   * Ergebnis am Lauf und führt ihn bei `ok == false` nicht aus. Adapter ohne Preflight laufen ungeprüft.
   */
  preflight?(request: PreflightRequest): Promise<PreflightResult>;
}

/** Adapter je Harness; fehlt einer, kann ein Lauf mit diesem Harness nicht ausgeführt werden. */
export type AdapterRegistry = Partial<Record<Harness, HarnessAdapter>>;

/**
 * Prüft einen Antworttext gegen das Ausgabeschema: kein JSON → `invalid_json`, nicht schemakonform oder
 * `unit_id` ungleich der angefragten Unit → `schema_violation` (beides Format-Fehler). Gemeinsame Prüfung
 * für alle Adapter; sie übergeben die `unitId` ihrer Aufgabe.
 */
export function parseAnswerText(text: string, expectedUnitId: string): HarnessOutcome {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { kind: "invalid_json", message: `Antwort ist kein JSON: ${(error as Error).message}` };
  }
  const parsed = unitAnswerSchema.safeParse(json);
  if (!parsed.success) {
    return {
      kind: "schema_violation",
      message: `Antwort verletzt das Ausgabeschema: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(Wurzel)"}: ${issue.message}`)
        .join("; ")}`,
    };
  }
  if (parsed.data.unit_id !== expectedUnitId) {
    return {
      kind: "schema_violation",
      message: `Antwort verletzt das Ausgabeschema: unit_id ist ${JSON.stringify(parsed.data.unit_id)}, angefragt war ${JSON.stringify(expectedUnitId)}`,
    };
  }
  return { kind: "answer", answer: parsed.data };
}
