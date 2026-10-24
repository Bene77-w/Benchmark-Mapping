import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Startet eine Agent-CLI als Kindprozess und sammelt ihre Ausgabe. Gemeinsam für alle echten Adapter
 * (Claude Code, Codex, OpenCode): Timeout mit Abbruch, Eingabe über stdin, gefilterte Umgebung.
 */

/** Umgebung eines Kindprozesses (Teilmenge von `process.env`). */
export type CliEnv = Record<string, string | undefined>;

export interface CliInvocation {
  command: string;
  args: string[];
  /** Arbeitsverzeichnis; Adapter nutzen ein leeres temporäres Verzeichnis (`withEmptyWorkdir`). */
  cwd: string;
  stdin?: string;
  /** Vollständige Umgebung des Kindprozesses (siehe `isolatedEnv`). */
  env: CliEnv;
  timeoutMs: number;
  /** Abbruch von außen: beendet den Prozess wie beim Timeout, meldet aber `aborted`. */
  signal?: AbortSignal;
}

export interface CliOutcome {
  stdout: string;
  stderr: string;
  /** `null`, wenn der Prozess durch ein Signal endete oder nicht startete. */
  exitCode: number | null;
  timedOut: boolean;
  /** Über `signal` abgebrochen. */
  aborted?: boolean;
  /** Startfehler, z. B. CLI nicht gefunden (`ENOENT`). */
  spawnError: string | null;
  durationMs: number;
}

/** Wartezeit zwischen SIGTERM und SIGKILL beim Timeout. */
const KILL_GRACE_MS = 5_000;

export type CliRunner = (invocation: CliInvocation) => Promise<CliOutcome>;

export const runCli: CliRunner = (invocation) =>
  new Promise((resolve) => {
    const started = performance.now();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let spawnError: string | null = null;
    let settled = false;

    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Prozess bereits beendet.
      }
    };
    let aborted = false;
    const stop = () => {
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, invocation.timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };
    if (invocation.signal?.aborted) onAbort();
    else invocation.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      invocation.signal?.removeEventListener("abort", onAbort);
      resolve({
        aborted,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        timedOut,
        spawnError,
        durationMs: performance.now() - started,
      });
    };

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      spawnError = `${invocation.command} konnte nicht gestartet werden: ${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
    child.stdin.on("error", () => {
      // Die CLI hat stdin geschlossen, bevor alles geschrieben war; ihre Ausgabe zählt.
    });
    child.stdin.end(invocation.stdin ?? "");
  });

/** Legt ein leeres temporäres Arbeitsverzeichnis an, führt `fn` darin aus und löscht es danach. */
export async function withEmptyWorkdir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Variablen, die eine CLI für Anmeldung und Laufzeit braucht. Alles andere (Datenbank-URL, Endpunkte,
 * Variablen der App) bleibt draußen, damit die Umgebung des Workers den Aufruf nicht verfälscht.
 */
const BASE_ENV = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
];

/** Umgebung aus der Positivliste plus `extra` (adapterspezifisch, z. B. `CODEX_HOME`). */
export function isolatedEnv(source: CliEnv, allowed: readonly string[] = [], extra: CliEnv = {}): CliEnv {
  const env: CliEnv = {};
  for (const name of [...BASE_ENV, ...allowed]) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  return { ...env, ...extra };
}

/** Rohprotokoll eines Aufrufs: Befehl (lange Argumente gekürzt), Exit-Code, stdout und stderr vollständig. */
export function formatCliLog(commandLine: string, outcome: CliOutcome, notes: string[] = []): string {
  return [
    `$ ${commandLine}`,
    ...notes,
    `Exit-Code: ${outcome.exitCode ?? "–"} · Dauer: ${Math.round(outcome.durationMs)} ms${outcome.timedOut ? " · Timeout" : ""}`,
    ...(outcome.spawnError ? [`Startfehler: ${outcome.spawnError}`] : []),
    "--- stdout ---",
    outcome.stdout,
    "--- stderr ---",
    outcome.stderr,
  ].join("\n");
}
