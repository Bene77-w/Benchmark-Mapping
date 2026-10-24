import os from "node:os";
import type { HarnessAdapter, HarnessOutcome, HarnessResult, HarnessTask } from "./adapter";
import { buildClaudeArgs, describeArgs } from "./claude-code-command";
import { looksRateLimited, readClaudeOutput } from "./claude-code-output";
import {
  type CliInvocation,
  type CliOutcome,
  type CliRunner,
  formatCliLog,
  isolatedEnv,
  runCli,
  withEmptyWorkdir,
} from "./cli-process";

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
  env: NodeJS.ProcessEnv;
  command?: string;
}

/** Der Aufruf einer Unit: Argumente, User-Prompt über stdin, leeres Arbeitsverzeichnis, gefilterte Umgebung. */
export function claudeInvocation(task: HarnessTask, options: ClaudeInvocationOptions): CliInvocation {
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
  env?: NodeJS.ProcessEnv;
  /** Startet die CLI; in Tests ein abgespielter Runner (Seam 3). */
  runCli?: CliRunner;
}

const WORKDIR_PREFIX = "benchmark-claude";

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
  };
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
  task: HarnessTask,
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
