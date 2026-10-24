import os from "node:os";
import type { TokenUsage } from "./adapter";

/**
 * Auslesen eines OpenCode-Aufrufs (v2, nach docs/research/kosten-codex-opencode.md):
 *
 * - `--format json`-Stream (stdout, NDJSON): Sitzungs-ID (jedes Event), Text, Werkzeugaufrufe, Fehler. Das
 *   `step_finish` des letzten Schritts fehlt im Stream (v2.1.3), Tokens kommen deshalb nicht von hier.
 * - `session export`: Modell samt Variante (bestätigter Effort), Tokens und Kosten der Sitzung (`info`), die
 *   Nachrichten mit Antworttext, Werkzeugaufrufen und Fehlern.
 */

type Json = Record<string, unknown>;

export interface OpencodeStream {
  sessionId: string | null;
  /** Text aller `text`-Events, in Reihenfolge. */
  text: string | null;
  errors: OpencodeError[];
}

export interface OpencodeError {
  type: string | null;
  message: string;
  status: number | null;
}

export function readOpencodeStream(stdout: string): OpencodeStream {
  let sessionId: string | null = null;
  const texts: string[] = [];
  const errors: OpencodeError[] = [];
  for (const event of jsonLines(stdout)) {
    sessionId ??= string(event.sessionID);
    const part = isObject(event.part) ? event.part : null;
    if (event.type === "text" && part && typeof part.text === "string") texts.push(part.text);
    if (event.type === "error") errors.push(readError(event.error));
  }
  return { sessionId, text: texts.length > 0 ? texts.join("") : null, errors };
}

export interface OpencodeExport {
  /** `provider/model` laut Sitzung. */
  model: string | null;
  /** Variante laut Sitzung (`default` ohne `#variant`). */
  variant: string | null;
  agent: string | null;
  /** Native Kosten der Sitzung (models.dev-Listenpreis zum Laufzeitpunkt). */
  cost: number | null;
  tokens: TokenUsage | null;
  /** `succeeded`, `failed`, … */
  outcome: string | null;
  /** Text der letzten Assistant-Nachricht mit Text. */
  text: string | null;
  /** Abgeschlossene Aufrufe des Werkzeugs `websearch`. */
  webSearches: number;
  /** Namen aller Werkzeugaufrufe (für die Isolationsprüfung). */
  tools: string[];
  errors: OpencodeError[];
}

/**
 * Liest `session export`. Tokens nach OpenCode-Konvention: `input` ohne Cache, `output` ohne Reasoning
 * (genau umgekehrt zu Codex) → `outputTokens` = output + reasoning (TokenUsage-Konvention).
 */
export function readOpencodeExport(text: string | null): OpencodeExport | null {
  if (!text) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(json) || !isObject(json.info)) return null;
  const info = json.info;
  const model = isObject(info.model) ? info.model : null;
  const messages = Array.isArray(json.messages) ? json.messages.filter(isObject) : [];
  let answer: string | null = null;
  let webSearches = 0;
  const tools: string[] = [];
  const errors: OpencodeError[] = [];
  for (const message of messages) {
    if (message.type === "assistant") {
      const content = Array.isArray(message.content) ? message.content.filter(isObject) : [];
      const texts = content.flatMap((part) =>
        part.type === "text" && typeof part.text === "string" ? [part.text] : [],
      );
      if (texts.length > 0) answer = texts.join("");
      for (const part of content.filter((part) => part.type === "tool")) {
        const name = string(part.name) ?? "?";
        tools.push(name);
        const state = isObject(part.state) ? part.state : {};
        if (name === "websearch" && state.status === "completed") webSearches += 1;
      }
    }
    // Fehler stehen an der Assistant-Nachricht und/oder am abschließenden `idle`.
    if ((message.type === "assistant" || message.type === "idle") && message.error !== undefined)
      errors.push(readError(message.error));
  }
  const providerId = model ? string(model.providerID) : null;
  const modelId = model ? string(model.id) : null;
  return {
    model: providerId && modelId ? `${providerId}/${modelId}` : modelId,
    variant: model ? string(model.variant) : null,
    agent: string(info.agent),
    cost: typeof info.cost === "number" ? info.cost : null,
    tokens: readTokens(info.tokens),
    outcome: string(info.outcome),
    text: answer,
    webSearches,
    tools,
    errors,
  };
}

function readTokens(value: unknown): TokenUsage | null {
  if (!isObject(value)) return null;
  const cache = isObject(value.cache) ? value.cache : {};
  const reasoning = number(value.reasoning);
  const usage = {
    inputTokens: number(value.input),
    cacheReadTokens: number(cache.read),
    cacheWriteTokens: number(cache.write),
    outputTokens: number(value.output) + reasoning,
    reasoningTokens: reasoning,
  };
  const total = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens;
  return total > 0 ? usage : null;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readError(value: unknown): OpencodeError {
  if (!isObject(value)) return { type: null, message: String(value), status: null };
  return {
    type: string(value.type),
    message: string(value.message) ?? JSON.stringify(value),
    status: typeof value.status === "number" ? value.status : null,
  };
}

function* jsonLines(text: string): Generator<Json> {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isObject(value)) yield value;
    } catch {
      // Keine JSON-Zeile (z. B. Hinweis der CLI); bleibt im Rohprotokoll.
    }
  }
}

const ID = /\b(ses|msg|prt|cred|call|tool)_[A-Za-z0-9]{10,}/g;
const TMP_ROOT = /benchmark-opencode-[A-Za-z0-9]{6}/g;
const PROJECT_ID = /"projectID":\s*"[0-9a-f]{16,}"/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;

/** Bereinigt eine Aufnahme: IDs, Home-Pfad, temporäre Pfade, Projekt-ID, E-Mail-Adressen. */
export function scrubOpencodeFixture(text: string, home = os.homedir()): string {
  return text
    .replaceAll(home, "/home/user")
    .replace(TMP_ROOT, "benchmark-opencode-XXXXXX")
    .replace(ID, "$1_000000")
    .replace(PROJECT_ID, '"projectID": "<entfernt>"')
    .replace(EMAIL, "user@example.com");
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
