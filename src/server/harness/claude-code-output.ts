import { type HarnessOutcome, parseAnswerText, type TokenUsage } from "./adapter";

/**
 * Auslesen der Ausgabe von `claude -p --output-format json` (nach docs/research/kosten-claude-code.md).
 * Die Ausgabe ist ein Event-Array (mit `--verbose`) oder ein einzelnes `result`-Objekt; maßgeblich ist das
 * letzte Element mit `type == "result"`. Tokens und Websuchen kommen aus `modelUsage` (deckt Hilfsaufrufe und
 * die interne Websuche ab), nie aus dem obersten `usage`, das nur die Hauptschleife zählt.
 */

type Json = Record<string, unknown>;

export interface ClaudeOutput {
  /** `null`, wenn kein `result`-Event da ist. */
  outcome: HarnessOutcome | null;
  rawResponse: string | null;
  tokens: TokenUsage | null;
  webSearches: number | null;
  nativeCostUsd: number | null;
  cliVersion: string | null;
  modelReported: string | null;
  /** Werkzeuge und MCP-Server laut `system/init` (`null`, wenn das Event fehlt). */
  init: { tools: string[]; mcpServers: unknown[] } | null;
  /** Letzte Ratenlimit-Info aus `rate_limit_event`. */
  rateLimit: RateLimitInfo | null;
}

export interface RateLimitInfo {
  status: string | null;
  resetsAt: Date | null;
}

export function parseClaudeEvents(stdout: string): Json[] {
  const text = stdout.trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(isObject);
    return isObject(parsed) ? [parsed] : [];
  } catch {
    // stream-json oder Hinweiszeilen: zeilenweise lesen.
    return text.split("\n").flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return isObject(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
  }
}

export function readClaudeOutput(stdout: string, expectedUnitId: string): ClaudeOutput {
  const events = parseClaudeEvents(stdout);
  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  const result = events.findLast((event) => event.type === "result");
  const rateLimit = readRateLimit(events);
  const modelUsage = isObject(result?.modelUsage) ? result.modelUsage : null;

  const base = {
    tokens: modelUsage ? readTokens(modelUsage) : null,
    webSearches: modelUsage ? readWebSearches(modelUsage) : null,
    nativeCostUsd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null,
    cliVersion: typeof init?.claude_code_version === "string" ? init.claude_code_version : null,
    modelReported: readModel(init, modelUsage),
    init: init
      ? {
          tools: Array.isArray(init.tools) ? init.tools.filter((tool) => typeof tool === "string") : [],
          mcpServers: Array.isArray(init.mcp_servers) ? init.mcp_servers : [],
        }
      : null,
    rateLimit,
  };
  if (!result) return { ...base, outcome: null, rawResponse: null };

  const resultText = typeof result.result === "string" ? result.result : null;
  if (result.is_error === true || (typeof result.subtype === "string" && result.subtype !== "success")) {
    return { ...base, outcome: errorOutcome(result, resultText, rateLimit), rawResponse: resultText };
  }
  // `structured_output` ist die von der CLI geprüfte Antwort; `result` trägt denselben Inhalt als Text.
  const rawResponse = isObject(result.structured_output)
    ? JSON.stringify(result.structured_output)
    : (resultText ?? "");
  return { ...base, outcome: parseAnswerText(rawResponse, expectedUnitId), rawResponse };
}

function readTokens(modelUsage: Json): TokenUsage | null {
  const models = Object.values(modelUsage).filter(isObject);
  if (models.length === 0) return null;
  const sum = (field: string) => models.reduce((total, model) => total + number(model[field]), 0);
  const hasThinking = models.some((model) => typeof model.thinkingTokens === "number");
  return {
    inputTokens: sum("inputTokens"),
    cacheReadTokens: sum("cacheReadInputTokens"),
    cacheWriteTokens: sum("cacheCreationInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningTokens: hasThinking ? sum("thinkingTokens") : null,
  };
}

function readWebSearches(modelUsage: Json): number | null {
  const models = Object.values(modelUsage).filter(isObject);
  if (!models.some((model) => typeof model.webSearchRequests === "number")) return models.length ? 0 : null;
  return models.reduce((total, model) => total + number(model.webSearchRequests), 0);
}

function readModel(init: Json | undefined, modelUsage: Json | null): string | null {
  if (typeof init?.model === "string") return init.model;
  const first = modelUsage ? Object.keys(modelUsage)[0] : undefined;
  return first ?? null;
}

function readRateLimit(events: Json[]): RateLimitInfo | null {
  const info = events
    .filter((event) => event.type === "rate_limit_event")
    .map((event) => event.rate_limit_info)
    .findLast(isObject);
  if (!info) return null;
  return {
    status: typeof info.status === "string" ? info.status : null,
    resetsAt: typeof info.resetsAt === "number" ? new Date(info.resetsAt * 1000) : null,
  };
}

const RATE_LIMIT_MARKS = ["rate limit", "rate_limit", "too many requests", "usage limit", "hit your limit"];

/** Erkennt ein Ratenlimit am Text (Fehlermeldung, stderr). */
export function looksRateLimited(text: string): boolean {
  const lower = text.toLowerCase();
  return RATE_LIMIT_MARKS.some((mark) => lower.includes(mark));
}

function errorOutcome(
  result: Json,
  resultText: string | null,
  rateLimit: RateLimitInfo | null,
): HarnessOutcome {
  const status = typeof result.api_error_status === "number" ? result.api_error_status : null;
  const message = [
    resultText ??
      (Array.isArray(result.errors) ? result.errors.join("; ") : null) ??
      "Claude Code meldet einen Fehler",
    `(subtype ${String(result.subtype)}${status === null ? "" : `, HTTP ${status}`})`,
  ].join(" ");
  if (status === 429 || rateLimit?.status === "rejected" || looksRateLimited(resultText ?? "")) {
    return {
      kind: "rate_limit",
      message,
      resetAt: rateLimit?.status === "rejected" ? rateLimit.resetsAt : null,
    };
  }
  if (result.subtype === "error_max_structured_output_retries") return { kind: "schema_violation", message };
  return { kind: "harness_error", message };
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
