import { access } from "node:fs/promises";
import path from "node:path";
import {
  type HarnessAdapter,
  type HarnessOutcome,
  type HarnessResult,
  type HarnessTask,
  parseAnswerText,
} from "./adapter";
import { looksRateLimited } from "./claude-code-output";
import {
  type CliEnv,
  type CliRunner,
  formatCliLog,
  isolatedEnv,
  runCli,
  withEmptyWorkdir,
} from "./cli-process";
import {
  type CodexRollout,
  type CodexStream,
  rateLimitResetAt,
  readCodexRollout,
  readCodexStream,
} from "./codex-output";
import { CODEX_COMMAND, type CodexCallResult, codexAuthHome, runCodexCall } from "./codex-sandbox";
import { type PreflightRequest, type PreflightStep, runPreflight } from "./preflight";

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
    preflight: (request) => codexPreflight(request, { ...options, ...callOptions }),
  };
}

const PREFLIGHT_TIMEOUT_MS = 3 * 60_000;

/** Probe des Preflights: kleinster Aufruf mit Modell, Effort und Websuche der Konfiguration. */
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

async function codexPreflight(
  request: PreflightRequest,
  options: CodexAdapterOptions & { runCli: CliRunner; env: CliEnv },
) {
  const command = options.command ?? CODEX_COMMAND;
  const timeoutMs = options.preflightTimeoutMs ?? PREFLIGHT_TIMEOUT_MS;
  const authHome = options.authHome ?? codexAuthHome(options.env);
  const expectedPlan = options.expectedPlan ?? "plus";
  let cliVersion: string | null = null;
  let probe: { stream: CodexStream; rollout: CodexRollout | null } | null = null;

  const steps: PreflightStep[] = [
    {
      id: "cli",
      label: "CLI erreichbar",
      async run() {
        const cli = await withEmptyWorkdir("benchmark-codex-version", (cwd) =>
          options.runCli({ command, args: ["--version"], cwd, env: isolatedEnv(options.env), timeoutMs }),
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
        return { status: "ok", message: `Codex CLI ${version}` };
      },
    },
    {
      id: "auth",
      label: "Anmeldung vorhanden",
      async run() {
        // Nur Existenz prüfen; die Datei wird nie gelesen.
        try {
          await access(path.join(authHome, "auth.json"));
        } catch {
          return { status: "failed", message: `keine auth.json in ${authHome} (CODEX_AUTH_HOME prüfen)` };
        }
        return { status: "ok", message: `auth.json aus ${authHome} wird verlinkt` };
      },
    },
    {
      id: "model",
      label: "Modell, Effort und Anmeldung",
      async run() {
        const call = await runCodexCall(
          { ...PROBE[request.mode], outputSchema: null, ...request, timeoutMs },
          { ...options, authHome },
        );
        const stream = readCodexStream(call.cli.stdout);
        const rollout = readCodexRollout(call.rollout);
        probe = { stream, rollout };
        const outcome = probeOutcome(call, stream, rollout, timeoutMs);
        if (outcome) return { status: "failed", message: outcome };
        return { status: "ok", message: `${rollout?.model ?? request.model} antwortet` };
      },
    },
    {
      id: "plan_type",
      label: "Plan (plan_type)",
      async run() {
        const plan = probe?.rollout?.rateLimits?.planType ?? null;
        if (!plan)
          return {
            status: "failed",
            message: "plan_type nicht ermittelbar (kein rate_limits im Rollout-Log)",
          };
        if (plan !== expectedPlan) {
          return {
            status: "failed",
            message: `plan_type ${plan}, erwartet ${expectedPlan} (CODEX_AUTH_HOME prüfen)`,
          };
        }
        const quota = probe?.rollout?.rateLimits?.windows
          .map((window) => `${window.name} ${window.usedPercent} %`)
          .join(" / ");
        return { status: "ok", message: `plan_type ${plan}${quota ? ` · Kontingent ${quota}` : ""}` };
      },
    },
    {
      id: "effort",
      label: "Effort bestätigt",
      async run() {
        const effort = probe?.rollout?.effort ?? null;
        if (!effort)
          return { status: "warning", message: "kein Effort im Rollout-Log; Läufe bleiben unbestätigt" };
        if (effort !== request.effort) {
          return {
            status: "failed",
            message: `Codex wendet Effort ${effort} an, angefordert war ${request.effort}`,
          };
        }
        return { status: "ok", message: `Effort ${effort} laut Rollout-Log angewendet` };
      },
    },
    {
      id: "isolation",
      label: "Isolation",
      async run() {
        const rollout = probe?.rollout;
        if (!rollout) return { status: "warning", message: "nicht prüfbar: kein Rollout-Log" };
        const foreign = rollout.skillRoots.filter((root) => !root.includes("/codex-home/"));
        if (rollout.sandbox !== "read-only" || foreign.length > 0) {
          return {
            status: "failed",
            message: `Sandbox ${rollout.sandbox ?? "–"}, fremde Skill-Verzeichnisse: ${foreign.join(", ") || "keine"}`,
          };
        }
        return {
          status: "ok",
          message: `Sandbox read-only; nur mitgelieferte Skills (${rollout.skillRoots.length} Verzeichnis(se) im temporären CODEX_HOME)`,
        };
      },
    },
    {
      id: "web_search",
      label: "Websuche",
      async run() {
        if (request.mode !== "web") return { status: "skipped", message: "nicht nötig im Modus ohne Web" };
        const searches = probe?.stream.webSearches ?? 0;
        if (searches < 1) {
          return {
            status: "failed",
            message: "die Probe hat keine Websuche ausgeführt (0 web_search-Items)",
          };
        }
        return { status: "ok", message: `${searches} Websuche(n) in der Probe ausgeführt` };
      },
    },
  ];
  return runPreflight(steps, () => cliVersion);
}

/** Fehlermeldung der Probe oder `null`, wenn sie geantwortet hat. */
function probeOutcome(
  call: CodexCallResult,
  stream: CodexStream,
  rollout: CodexRollout | null,
  timeoutMs: number,
): string | null {
  const outcome = outcomeOf({ unitId: "preflight", timeoutMs }, call, stream, rollout);
  if (outcome.kind === "rate_limit") {
    const reset = outcome.resetAt ? `, Freigabe ${outcome.resetAt.toISOString()}` : "";
    return `Ratenlimit erreicht${reset}: ${outcome.message}`;
  }
  // Die Probe antwortet frei („ok“); kein JSON ist hier kein Fehler.
  if (outcome.kind === "invalid_json" || outcome.kind === "schema_violation" || outcome.kind === "answer")
    return null;
  return outcome.message;
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
