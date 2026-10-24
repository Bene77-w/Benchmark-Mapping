import os from "node:os";
import type { HarnessAdapter, HarnessOutcome, HarnessResult, HarnessTask } from "./adapter";
import { buildClaudeArgs, CLAUDE_WEB_TOOLS, type ClaudeCall, describeArgs } from "./claude-code-command";
import { type ClaudeOutput, looksRateLimited, readClaudeOutput } from "./claude-code-output";
import {
  type CliEnv,
  type CliInvocation,
  type CliOutcome,
  type CliRunner,
  formatCliLog,
  isolatedEnv,
  runCli,
  withEmptyWorkdir,
} from "./cli-process";
import { type PreflightRequest, type PreflightStep, runPreflight } from "./preflight";

/**
 * Claude-Code-Adapter: schickt eine Unit isoliert an `claude -p` (siehe claude-code-command.ts) und liest das
 * Ergebnis aus (claude-code-output.ts). Claude Code meldet den verwendeten Effort nicht; `effort.confirmed`
 * bleibt deshalb immer `false`.
 */

export const CLAUDE_COMMAND = "claude";
/** Variablen, die Claude Code zusätzlich zur Grundumgebung braucht (eigenes Konfigurationsverzeichnis). */
const CLAUDE_ENV = ["CLAUDE_CONFIG_DIR"];

export interface ClaudeInvocationOptions {
  cwd: string;
  env: CliEnv;
  command?: string;
}

/** Der Aufruf einer Unit: Argumente, User-Prompt über stdin, leeres Arbeitsverzeichnis, gefilterte Umgebung. */
export function claudeInvocation(
  task: ClaudeCall & Pick<HarnessTask, "userPrompt" | "timeoutMs">,
  options: ClaudeInvocationOptions,
): CliInvocation {
  return {
    command: options.command ?? CLAUDE_COMMAND,
    args: buildClaudeArgs(task),
    cwd: options.cwd,
    stdin: task.userPrompt,
    env: isolatedEnv(options.env, CLAUDE_ENV),
    timeoutMs: task.timeoutMs,
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const API_ID = /\b(msg|toolu|srvtoolu|req)_[A-Za-z0-9]+/g;
const SIGNATURE = /"signature":"[^"]*"/g;

/**
 * Entfernt aus einer aufgezeichneten Ausgabe IDs (Session, Nachrichten, Requests), Thinking-Signaturen und das
 * Home-Verzeichnis.
 */
export function scrubFixture(text: string, home = os.homedir()): string {
  return text
    .replaceAll(home, "/home/user")
    .replace(UUID, "00000000-0000-0000-0000-000000000000")
    .replace(API_ID, "$1_000000")
    .replace(SIGNATURE, '"signature":"<entfernt>"');
}

export interface ClaudeCodeAdapterOptions {
  /** Name oder Pfad der CLI, Standard `claude`. */
  command?: string;
  /** Umgebung, aus der die erlaubten Variablen übernommen werden (Standard `process.env`). */
  env?: CliEnv;
  /** Startet die CLI; in Tests ein abgespielter Runner (Seam 3). */
  runCli?: CliRunner;
  /** Höchstdauer je Preflight-Aufruf, Standard 3 Minuten. */
  preflightTimeoutMs?: number;
}

const WORKDIR_PREFIX = "benchmark-claude";
const PREFLIGHT_TIMEOUT_MS = 3 * 60_000;

/** Probe des Preflights: kleinster Aufruf mit Modell, Effort und Werkzeugen der Konfiguration. */
const PROBE = {
  text_only: {
    systemPrompt: "Du bist ein Funktionstest. Antworte nur mit: ok",
    userPrompt: "Funktionstest",
  },
  web: {
    systemPrompt:
      "Du bist ein Funktionstest der Websuche. Führe genau eine Websuche nach „United States Congress“ aus und antworte danach nur mit: ok",
    userPrompt: "Funktionstest Websuche",
  },
} as const;

export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions = {}): HarnessAdapter {
  const run = options.runCli ?? runCli;
  const env = options.env ?? process.env;
  return {
    harness: "claude_code",
    async run(task) {
      let commandLine = "";
      const cli = await withEmptyWorkdir(WORKDIR_PREFIX, (cwd) => {
        const invocation = claudeInvocation(task, { cwd, env, command: options.command });
        commandLine = `${invocation.command} ${describeArgs(invocation.args)}`;
        return run(invocation);
      });
      return toResult(task, cli, commandLine);
    },
    preflight: (request) => claudePreflight(request, { ...options, runCli: run, env }),
  };
}

async function claudePreflight(
  request: PreflightRequest,
  options: ClaudeCodeAdapterOptions & { runCli: CliRunner; env: CliEnv },
) {
  const command = options.command ?? CLAUDE_COMMAND;
  const timeoutMs = options.preflightTimeoutMs ?? PREFLIGHT_TIMEOUT_MS;
  let cliVersion: string | null = null;
  let probe: { cli: CliOutcome; output: ClaudeOutput } | null = null;

  const steps: PreflightStep[] = [
    {
      id: "cli",
      label: "CLI erreichbar",
      async run() {
        const cli = await withEmptyWorkdir(WORKDIR_PREFIX, (cwd) =>
          options.runCli({
            command,
            args: ["--version"],
            cwd,
            env: isolatedEnv(options.env, CLAUDE_ENV),
            timeoutMs,
          }),
        );
        if (cli.spawnError) return { status: "failed", message: cli.spawnError };
        const version = /\d+\.\d+\.\d+/.exec(cli.stdout)?.[0] ?? null;
        if (cli.exitCode !== 0 || !version) {
          return {
            status: "failed",
            message: `${command} --version scheiterte (Exit-Code ${cli.exitCode ?? "–"}): ${(cli.stderr || cli.stdout).trim()}`,
          };
        }
        cliVersion = version;
        return { status: "ok", message: `Claude Code ${version}` };
      },
    },
    {
      id: "model",
      label: "Modell, Effort und Anmeldung",
      async run() {
        const call = { ...PROBE[request.mode], outputSchema: null, ...request, timeoutMs };
        const cli = await withEmptyWorkdir(WORKDIR_PREFIX, (cwd) =>
          options.runCli(claudeInvocation(call, { cwd, env: options.env, command })),
        );
        const output = readClaudeOutput(cli.stdout, "preflight");
        probe = { cli, output };
        const outcome = outcomeOf(
          { timeoutMs },
          cli,
          output.outcome,
          output.rateLimit?.status === "rejected",
        );
        if (outcome.kind === "rate_limit") {
          const reset = outcome.resetAt ? `, Freigabe ${outcome.resetAt.toISOString()}` : "";
          return { status: "failed", message: `Ratenlimit erreicht${reset}: ${outcome.message}` };
        }
        if (outcome.kind === "harness_error" || outcome.kind === "timeout") {
          return { status: "failed", message: outcome.message };
        }
        return {
          status: "ok",
          message: `${output.modelReported ?? request.model} antwortet mit Effort ${request.effort} (von Claude Code nicht bestätigt)`,
        };
      },
    },
    {
      id: "isolation",
      label: "Isolation",
      async run() {
        const init = probe?.output.init;
        if (!init)
          return { status: "warning", message: "nicht prüfbar: die Probe enthielt kein system/init-Event" };
        const allowed = new Set<string>([
          "StructuredOutput",
          ...(request.mode === "web" ? CLAUDE_WEB_TOOLS : []),
        ]);
        const extra = init.tools.filter((tool) => !allowed.has(tool));
        if (extra.length > 0 || init.mcpServers.length > 0) {
          return {
            status: "failed",
            message: `unerwartete Werkzeuge ${extra.join(", ") || "–"}, MCP-Server ${init.mcpServers.length}`,
          };
        }
        return { status: "ok", message: `Werkzeuge: ${init.tools.join(", ") || "keine"}; keine MCP-Server` };
      },
    },
    {
      id: "web_search",
      label: "Websuche",
      async run() {
        if (request.mode !== "web") return { status: "skipped", message: "nicht nötig im Modus ohne Web" };
        const searches = probe?.output.webSearches ?? 0;
        if (searches < 1) {
          return {
            status: "failed",
            message: "die Probe hat keine Websuche ausgeführt (0 Suchen laut modelUsage)",
          };
        }
        return { status: "ok", message: `${searches} Websuche(n) in der Probe ausgeführt` };
      },
    },
  ];
  return runPreflight(steps, () => cliVersion);
}

function toResult(task: HarnessTask, cli: CliOutcome, commandLine: string): HarnessResult {
  const output = readClaudeOutput(cli.stdout, task.unitId);
  return {
    outcome: outcomeOf(task, cli, output.outcome, output.rateLimit?.status === "rejected"),
    rawResponse: output.rawResponse,
    log: formatCliLog(commandLine, cli, [
      `Arbeitsverzeichnis: leer, temporär · User-Prompt über stdin (${task.userPrompt.length} Zeichen)`,
    ]),
    tokens: output.tokens,
    webSearches: output.webSearches,
    effort: { reported: null, confirmed: false },
    nativeCostUsd: output.nativeCostUsd,
    durationMs: cli.durationMs,
    exitCode: cli.exitCode,
    cliVersion: output.cliVersion,
    modelReported: output.modelReported,
  };
}

function outcomeOf(
  task: Pick<HarnessTask, "timeoutMs">,
  cli: CliOutcome,
  parsed: HarnessOutcome | null,
  rejected: boolean,
): HarnessOutcome {
  if (cli.spawnError) return { kind: "harness_error", message: cli.spawnError };
  if (cli.timedOut) {
    // Die CLI wiederholt ein 429 selbst; reißt sie dabei den Timeout, steht der Grund nur im Protokoll.
    if (looksRateLimited(cli.stderr)) {
      return { kind: "rate_limit", message: `Ratenlimit (Timeout nach ${task.timeoutMs} ms)`, resetAt: null };
    }
    return { kind: "timeout", message: `Kein Ergebnis innerhalb von ${task.timeoutMs} ms` };
  }
  if (parsed) return parsed;
  const detail = (cli.stderr.trim() || cli.stdout.trim()).slice(-500) || "keine Ausgabe";
  if (rejected || looksRateLimited(detail)) return { kind: "rate_limit", message: detail, resetAt: null };
  return {
    kind: "harness_error",
    message: `Claude Code lieferte kein Ergebnis (Exit-Code ${cli.exitCode ?? "–"}): ${detail}`,
  };
}
