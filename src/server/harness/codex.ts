import {
  type HarnessAdapter,
  type HarnessOutcome,
  type HarnessResult,
  type HarnessTask,
  parseAnswerText,
} from "./adapter";
import { looksRateLimited } from "./claude-code-output";
import { type CliEnv, type CliRunner, formatCliLog, runCli } from "./cli-process";
import {
  type CodexRollout,
  type CodexStream,
  rateLimitResetAt,
  readCodexRollout,
  readCodexStream,
} from "./codex-output";
import { type CodexCallResult, runCodexCall } from "./codex-sandbox";

/**
 * Codex-Adapter: schickt eine Unit isoliert an `codex exec` (Aufruf: codex-command.ts, temporäres Verzeichnis
 * und Anmeldung: codex-sandbox.ts) und liest das Ergebnis aus (codex-output.ts). Die Antwort kommt nur aus der
 * Abschlussdatei und nur bei Exit-Code 0 (wie im Submapper). Codex meldet keine Kosten (`nativeCostUsd` null).
 * Der Effort gilt als bestätigt, wenn das Rollout-Log die angeforderte Stufe als angewendet meldet.
 */

export interface CodexAdapterOptions {
  /** Name oder Pfad der CLI, Standard `codex`. */
  command?: string;
  /** Umgebung, aus der die erlaubten Variablen übernommen werden (Standard `process.env`). */
  env?: CliEnv;
  /** Verzeichnis mit `auth.json`, die verlinkt wird; Standard `CODEX_AUTH_HOME` → `CODEX_HOME` → `~/.codex`. */
  authHome?: string;
  /** Startet die CLI; in Tests ein abgespielter Runner (Seam 3). */
  runCli?: CliRunner;
  /** Höchstdauer je Preflight-Aufruf, Standard 3 Minuten. */
  preflightTimeoutMs?: number;
  /** Erwarteter Plan laut `plan_type` im Preflight, Standard `plus`. */
  expectedPlan?: string;
}

export function createCodexAdapter(options: CodexAdapterOptions = {}): HarnessAdapter {
  const run = options.runCli ?? runCli;
  const env = options.env ?? process.env;
  const callOptions = { runCli: run, env, command: options.command, authHome: options.authHome };
  return {
    harness: "codex",
    async run(task) {
      const call = await runCodexCall(task, callOptions);
      return toResult(task, call);
    },
  };
}

export function toResult(task: HarnessTask, call: CodexCallResult): HarnessResult {
  const stream = readCodexStream(call.cli.stdout);
  const rollout = readCodexRollout(call.rollout);
  return {
    outcome: outcomeOf(task, call, stream, rollout),
    rawResponse: call.lastMessage,
    log: formatCliLog(call.commandLine, call.cli, [
      `Arbeitsverzeichnis: leer, temporär · CODEX_HOME: temporär, auth.json als Symlink · Prompt über stdin (${task.systemPrompt.length + task.userPrompt.length + 2} Zeichen)`,
      ...(call.authMissing ? [call.authMissing] : []),
      describeRollout(rollout),
    ]),
    tokens: stream.tokens,
    webSearches: stream.webSearches,
    effort: { reported: rollout?.effort ?? null, confirmed: rollout?.effort === task.effort },
    nativeCostUsd: null,
    durationMs: call.cli.durationMs,
    exitCode: call.cli.exitCode,
    cliVersion: rollout?.cliVersion ?? null,
    modelReported: rollout?.model ?? null,
  };
}

function outcomeOf(
  task: Pick<HarnessTask, "unitId" | "timeoutMs">,
  call: CodexCallResult,
  stream: CodexStream,
  rollout: CodexRollout | null,
): HarnessOutcome {
  const { cli } = call;
  if (call.authMissing) return { kind: "harness_error", message: call.authMissing };
  if (cli.spawnError) return { kind: "harness_error", message: cli.spawnError };
  if (cli.aborted) return { kind: "harness_error", message: "Aufruf abgebrochen" };
  const detail =
    (stream.errors.join("; ") || cli.stderr.trim() || cli.stdout.trim()).slice(-500) || "keine Ausgabe";
  const rateLimited = Boolean(rollout?.rateLimits?.reachedType) || looksRateLimited(detail);
  if (cli.timedOut) {
    if (rateLimited) {
      return { kind: "rate_limit", message: `Ratenlimit (Timeout nach ${task.timeoutMs} ms)`, resetAt: null };
    }
    return { kind: "timeout", message: `Kein Ergebnis innerhalb von ${task.timeoutMs} ms` };
  }
  if (cli.exitCode === 0 && call.lastMessage !== null)
    return parseAnswerText(call.lastMessage.trim(), task.unitId);
  if (rateLimited)
    return { kind: "rate_limit", message: detail, resetAt: rateLimitResetAt(rollout?.rateLimits ?? null) };
  return {
    kind: "harness_error",
    message: `Codex lieferte keine Antwort (Exit-Code ${cli.exitCode ?? "–"}): ${detail}`,
  };
}

/** Kurzfassung des Rollout-Logs fürs Protokoll (das Log selbst enthält den ganzen Prompt). */
function describeRollout(rollout: CodexRollout | null): string {
  if (!rollout) return "Rollout-Log: keins gefunden (Effort unbestätigt)";
  const limits = rollout.rateLimits;
  const quota = limits
    ? `, plan_type ${limits.planType ?? "–"}, Kontingent ${
        limits.windows.map((window) => `${window.name} ${window.usedPercent} %`).join(" / ") || "–"
      }${limits.reachedType ? `, Limit erreicht: ${limits.reachedType}` : ""}`
    : "";
  return `Rollout-Log: Modell ${rollout.model ?? "–"}, Effort ${rollout.effort ?? "–"}, Sandbox ${rollout.sandbox ?? "–"}, CLI ${rollout.cliVersion ?? "–"}${quota}`;
}
