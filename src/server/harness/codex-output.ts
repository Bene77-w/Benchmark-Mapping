import os from "node:os";
import type { TokenUsage } from "./adapter";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const API_ID = /\b(resp|msg|call|rs|ws|fc|req|item)_[A-Za-z0-9]{12,}/g;
const TMP_ROOT = /benchmark-codex-[A-Za-z0-9]+/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ID_FIELD = /"([A-Za-z_]*(?:account|user|installation|org|organization|workspace)_?id)":"[^"]*"/gi;

/**
 * Bereinigt eine aufgezeichnete Codex-Ausgabe: Home-Pfad, temporäres Verzeichnis, Thread-/Request-IDs,
 * E-Mail-Adressen und Konto-/Installations-IDs.
 */
export function scrubCodexFixture(text: string, home = os.homedir()): string {
  return text
    .replaceAll(home, "/home/user")
    .replace(TMP_ROOT, "benchmark-codex-XXXXXX")
    .replace(UUID, "00000000-0000-0000-0000-000000000000")
    .replace(API_ID, "$1_000000")
    .replace(EMAIL, "user@example.com")
    .replace(ID_FIELD, '"$1":"<entfernt>"');
}

/**
 * Auslesen eines Codex-Aufrufs (nach docs/research/kosten-codex-opencode.md):
 *
 * - `--json`-Stream (stdout, JSONL): Tokens aus `turn.completed.usage` (`input_tokens` enthält die gecachten
 *   Tokens, `output_tokens` die Reasoning-Tokens), Websuchen = `item.completed` mit `item.type == "web_search"`
 *   (`item.started` zählt nicht), Fehler aus `error` und `turn.failed`.
 * - Rollout-Log: Modell und tatsächlich angewendeter Effort (`turn_context`, sonst `thread_settings_applied`),
 *   CLI-Version (`session_meta`) und Kontingent (`token_count.rate_limits` mit `plan_type`). Das Format ist
 *   intern; fehlt ein Feld, bleibt der Wert `null` (Effort dann „unbestätigt“).
 */

type Json = Record<string, unknown>;

export interface CodexStream {
  tokens: TokenUsage | null;
  /** `null`, wenn der Stream gar keine Events enthielt. */
  webSearches: number | null;
  /** Fehlermeldungen aus `error`/`turn.failed` (ohne Wiederholungen), in Reihenfolge. */
  errors: string[];
  turnCompleted: boolean;
}

export interface CodexRateLimits {
  planType: string | null;
  /** Gesetzt, wenn ein Limit erreicht ist (z. B. `primary`). */
  reachedType: string | null;
  windows: Array<{ name: string; usedPercent: number; windowMinutes: number | null; resetsAt: Date | null }>;
}

export interface CodexRollout {
  cliVersion: string | null;
  model: string | null;
  effort: string | null;
  sandbox: string | null;
  /** Verzeichnisse der Skills laut Systemnachricht (`Skill roots`). */
  skillRoots: string[];
  rateLimits: CodexRateLimits | null;
}

export function parseJsonLines(text: string): Json[] {
  return text.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return isObject(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

export function readCodexStream(stdout: string): CodexStream {
  const events = parseJsonLines(stdout);
  const usages = events
    .filter((event) => event.type === "turn.completed" && isObject(event.usage))
    .map((event) => event.usage as Json);
  const errors: string[] = [];
  for (const event of events) {
    const message =
      event.type === "error"
        ? event.message
        : event.type === "turn.failed" && isObject(event.error)
          ? event.error.message
          : null;
    if (typeof message === "string" && !errors.includes(message)) errors.push(message);
  }
  const webSearches = events.filter(
    (event) => event.type === "item.completed" && isObject(event.item) && event.item.type === "web_search",
  ).length;
  return {
    tokens: usages.length > 0 ? readTokens(usages) : null,
    webSearches: events.length > 0 ? webSearches : null,
    errors,
    turnCompleted: usages.length > 0,
  };
}

function readTokens(usages: Json[]): TokenUsage {
  const sum = (field: string) => usages.reduce((total, usage) => total + number(usage[field]), 0);
  const cached = sum("cached_input_tokens");
  return {
    // `input_tokens` enthält die gecachten Tokens (non_cached_input in codex-rs/protocol).
    inputTokens: Math.max(0, sum("input_tokens") - cached),
    cacheReadTokens: cached,
    cacheWriteTokens: sum("cache_write_input_tokens"),
    outputTokens: sum("output_tokens"),
    reasoningTokens: usages.some((usage) => typeof usage.reasoning_output_tokens === "number")
      ? sum("reasoning_output_tokens")
      : null,
  };
}

export function readCodexRollout(text: string | null): CodexRollout | null {
  if (text === null) return null;
  const entries = parseJsonLines(text);
  if (entries.length === 0) return null;
  const payloads = (type: string) =>
    entries
      .filter((entry) => entry.type === type && isObject(entry.payload))
      .map((entry) => entry.payload as Json);
  const events = payloads("event_msg");
  const meta = payloads("session_meta").at(-1);
  const context = payloads("turn_context").at(-1);
  const settings = events.findLast((event) => event.type === "thread_settings_applied")?.thread_settings;
  const threadSettings = isObject(settings) ? settings : null;
  const sandbox = isObject(context?.sandbox_policy) ? context.sandbox_policy.type : null;
  const rateLimits = events
    .filter((event) => event.type === "token_count")
    .map((event) => event.rate_limits)
    .findLast(isObject);
  return {
    cliVersion: string(meta?.cli_version),
    model: string(context?.model) ?? string(threadSettings?.model),
    effort: string(context?.effort) ?? string(threadSettings?.reasoning_effort),
    sandbox: string(sandbox),
    skillRoots: readSkillRoots(payloads("response_item")),
    rateLimits: rateLimits ? readRateLimits(rateLimits) : null,
  };
}

function readSkillRoots(items: Json[]): string[] {
  const roots: string[] = [];
  for (const item of items) {
    if (item.role !== "developer" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      const text = isObject(part) ? part.text : null;
      if (typeof text !== "string" || !text.includes("Skill roots")) continue;
      for (const match of text.matchAll(/^- `r\d+` = `([^`]+)`/gm)) roots.push(match[1]);
    }
  }
  return roots;
}

function readRateLimits(info: Json): CodexRateLimits {
  const windows = (["primary", "secondary"] as const).flatMap((name) => {
    const window = info[name];
    if (!isObject(window) || typeof window.used_percent !== "number") return [];
    return [
      {
        name,
        usedPercent: window.used_percent,
        windowMinutes: typeof window.window_minutes === "number" ? window.window_minutes : null,
        resetsAt: typeof window.resets_at === "number" ? new Date(window.resets_at * 1000) : null,
      },
    ];
  });
  return { planType: string(info.plan_type), reachedType: string(info.rate_limit_reached_type), windows };
}

/** Freigabezeitpunkt eines erreichten Limits: das (späteste) Fenster mit 100 % bzw. das gemeldete. */
export function rateLimitResetAt(limits: CodexRateLimits | null): Date | null {
  if (!limits) return null;
  const exhausted = limits.windows.filter(
    (window) => window.name === limits.reachedType || window.usedPercent >= 100,
  );
  const times = exhausted.flatMap((window) => (window.resetsAt ? [window.resetsAt.getTime()] : []));
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
