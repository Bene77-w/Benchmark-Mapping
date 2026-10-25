import type { HarnessAdapter, HarnessOutcome, HarnessResult, HarnessTask } from "./adapter";
import { parseAnswerText } from "./adapter";
import { looksRateLimited } from "./claude-code-output";
import {
  type CliEnv,
  type CliRunner,
  formatCliLog,
  isolatedEnv,
  runCli,
  withEmptyWorkdir,
} from "./cli-process";
import { DEFAULT_VARIANT } from "./opencode-command";
import {
  type OpencodeError,
  type OpencodeExport,
  type OpencodeStream,
  readOpencodeExport,
  readOpencodeStream,
} from "./opencode-output";
import { opencodePreflight } from "./opencode-preflight";
import {
  MISSING_FORMAT_INSTRUCTION,
  OPENCODE_COMMAND,
  type OpencodeCallResult,
  runOpencodeCall,
} from "./opencode-sandbox";

/**
 * OpenCode-Adapter: schickt eine Unit isoliert an `opencode run` (Aufruf und Konfiguration:
 * opencode-command.ts, temporäre Verzeichnisse und Sitzung: opencode-sandbox.ts) und liest Stream und
 * Sitzungsexport aus (opencode-output.ts). Antwort, Tokens, Kosten, Modell und Variante kommen aus dem Export,
 * der Stream dient als Rückfall für Text und Fehler. Die Variante (`#effort`) gilt als bestätigt, wenn der
 * Export sie meldet. Der Exit-Code allein entscheidet nicht: OpenCode endet z. B. nach einem abgebrochenen
 * Werkzeug mit 1, obwohl die Antwort vollständig ist.
 */

export interface OpencodeAdapterOptions {
  /** Name oder Pfad der CLI, Standard `opencode`. */
  command?: string;
  /** Umgebung, aus der die erlaubten Variablen übernommen werden (Standard `process.env`). */
  env?: CliEnv;
  /** Basis des Datenverzeichnisses mit Anmeldung und Sitzungen; Standard `OPENCODE_DATA_HOME` → `XDG_DATA_HOME` → `~/.local/share`. */
  dataHome?: string;
  /** Suchanbieter im Modus mit Web; Standard `OPENCODE_WEBSEARCH_PROVIDER`. Ohne Anbieter keine Läufe mit Web. */
  websearchProvider?: string;
  /** Startet die CLI; in Tests ein abgespielter Runner (Seam 3). */
  runCli?: CliRunner;
  /** Höchstdauer je Preflight-Aufruf, Standard 3 Minuten. */
  preflightTimeoutMs?: number;
}

export interface ResolvedOpencodeOptions {
  command: string;
  env: CliEnv;
  runCli: CliRunner;
  dataHome: string | undefined;
  websearchProvider: string | null;
  preflightTimeoutMs: number;
}

const PREFLIGHT_TIMEOUT_MS = 3 * 60_000;
const VERSION_TIMEOUT_MS = 30_000;

export function createOpencodeAdapter(options: OpencodeAdapterOptions = {}): HarnessAdapter {
  const env = options.env ?? process.env;
  const resolved: ResolvedOpencodeOptions = {
    command: options.command ?? OPENCODE_COMMAND,
    env,
    runCli: options.runCli ?? runCli,
    dataHome: options.dataHome,
    websearchProvider: options.websearchProvider || env.OPENCODE_WEBSEARCH_PROVIDER || null,
    preflightTimeoutMs: options.preflightTimeoutMs ?? PREFLIGHT_TIMEOUT_MS,
  };
  let version: Promise<string | null> | null = null;
  const cliVersion = () => {
    version ??= opencodeVersion(resolved).then((outcome) => outcome.version);
    return version;
  };
  return {
    harness: "opencode",
    inlinesOutputSchema: true,
    async run(task) {
      if (!task.formatInstruction) return notStarted(task, MISSING_FORMAT_INSTRUCTION);
      if (task.mode === "web" && !resolved.websearchProvider) {
        return notStarted(task, `Modus mit Web nicht möglich: ${NO_SEARCH_PROVIDER}`);
      }
      const call = await runOpencodeCall(task, resolved);
      return toResult(task, call, await cliVersion());
    },
    preflight: (request) => opencodePreflight(request, resolved),
  };
}

/** `opencode --version` in einem leeren Verzeichnis. */
export async function opencodeVersion(
  options: Pick<ResolvedOpencodeOptions, "command" | "env" | "runCli">,
): Promise<{ version: string | null; error: string | null }> {
  const cli = await withEmptyWorkdir("benchmark-opencode-version", (cwd) =>
    options.runCli({
      command: options.command,
      args: ["--version"],
      cwd,
      env: isolatedEnv(options.env),
      timeoutMs: VERSION_TIMEOUT_MS,
    }),
  );
  if (cli.spawnError) return { version: null, error: cli.spawnError };
  const version = /\d+\.\d+\.\d+/.exec(cli.stdout)?.[0] ?? null;
  if (cli.exitCode !== 0 || !version) {
    return {
      version: null,
      error: `${options.command} --version scheiterte (Exit-Code ${cli.exitCode ?? "–"}): ${(cli.stderr || cli.stdout).trim()}`,
    };
  }
  return { version, error: null };
}

export const NO_SEARCH_PROVIDER =
  "kein Suchanbieter eingerichtet: OPENCODE_WEBSEARCH_PROVIDER setzen (exa, firecrawl, parallel, tavily, tinyfish oder random)";

function notStarted(task: HarnessTask, message: string): HarnessResult {
  return {
    outcome: { kind: "harness_error", message },
    rawResponse: null,
    log: `Nicht gestartet: ${message} (Unit ${task.unitId})`,
    tokens: null,
    webSearches: null,
    effort: { reported: null, confirmed: false },
    nativeCostUsd: null,
    durationMs: 0,
    exitCode: null,
    cliVersion: null,
    modelReported: null,
  };
}

export function toResult(
  task: HarnessTask,
  call: OpencodeCallResult,
  cliVersion: string | null,
): HarnessResult {
  const stream = readOpencodeStream(call.cli.stdout);
  const exported = readOpencodeExport(call.exported);
  const text = exported?.text ?? stream.text;
  return {
    outcome: outcomeOf(task, call, stream, exported, text),
    rawResponse: text,
    log: formatCliLog(call.commandLine, call.cli, [
      `Arbeitsverzeichnis: leer, temporär · Konfiguration, HOME, Cache, State: temporär · Datenverzeichnis des Nutzers (Anmeldung) · User-Prompt über stdin (${task.userPrompt.length} Zeichen)`,
      describeExport(exported),
      ...call.cleanup,
    ]),
    tokens: exported?.tokens ?? null,
    webSearches: exported ? exported.webSearches : null,
    effort: {
      reported: exported?.variant ?? null,
      confirmed: exported?.variant != null && exported.variant === (task.effort || DEFAULT_VARIANT),
    },
    nativeCostUsd: exported?.cost ?? null,
    durationMs: call.cli.durationMs,
    exitCode: call.cli.exitCode,
    cliVersion,
    modelReported: exported?.model ?? null,
  };
}

export function outcomeOf(
  task: Pick<HarnessTask, "unitId" | "timeoutMs">,
  call: OpencodeCallResult,
  stream: OpencodeStream,
  exported: OpencodeExport | null,
  text: string | null,
): HarnessOutcome {
  const { cli } = call;
  if (cli.spawnError) return { kind: "harness_error", message: cli.spawnError };
  if (cli.aborted) return { kind: "harness_error", message: "Aufruf abgebrochen" };
  const errors = uniqueErrors([...stream.errors, ...(exported?.errors ?? [])]);
  const rateLimit = errors.find((error) => error.status === 429 || looksRateLimited(error.message));
  if (rateLimit) return { kind: "rate_limit", message: describeError(rateLimit), resetAt: null };
  if (cli.timedOut) return { kind: "timeout", message: `Kein Ergebnis innerhalb von ${task.timeoutMs} ms` };
  if (errors.length > 0) {
    return {
      kind: "harness_error",
      message: `OpenCode meldet einen Fehler (Exit-Code ${cli.exitCode ?? "–"}): ${errors.map(describeError).join("; ")}`,
    };
  }
  if (text !== null) return parseAnswerText(stripCodeFence(text), task.unitId);
  const detail = (cli.stderr.trim() || cli.stdout.trim()).slice(-500) || "keine Ausgabe";
  return {
    kind: "harness_error",
    message: `OpenCode lieferte keine Antwort (Exit-Code ${cli.exitCode ?? "–"}): ${detail}`,
  };
}

/** Entfernt einen einzelnen umschließenden Markdown-Codeblock (```json … ```), sonst unverändert. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

function uniqueErrors(errors: OpencodeError[]): OpencodeError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.type}|${error.status}|${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeError(error: OpencodeError): string {
  const detail = [error.type, error.status === null ? null : `HTTP ${error.status}`]
    .filter(Boolean)
    .join(", ");
  return detail ? `${error.message} (${detail})` : error.message;
}

/** Kurzfassung des Exports fürs Protokoll (der Export selbst enthält den ganzen Prompt). */
function describeExport(exported: OpencodeExport | null): string {
  if (!exported) return "Sitzungsexport: keiner (Tokens und Variante unbekannt)";
  return `Sitzungsexport: Modell ${exported.model ?? "–"}, Variante ${exported.variant ?? "–"}, Agent ${exported.agent ?? "–"}, Ergebnis ${exported.outcome ?? "–"}, Kosten ${exported.cost ?? "–"} USD, Werkzeuge ${exported.tools.join(", ") || "keine"}`;
}
