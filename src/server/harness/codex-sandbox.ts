import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JsonSchema } from "@/server/prompt/output-schema";
import { type CliEnv, type CliOutcome, type CliRunner, isolatedEnv } from "./cli-process";
import { buildCodexArgs, type CodexCall, codexStdin, describeCodexArgs } from "./codex-command";

/**
 * Ein Codex-Aufruf in einem temporären Verzeichnis, das danach vollständig entfernt wird:
 *
 *   <tmp>/work        leeres Arbeitsverzeichnis (cwd und `-C`)
 *   <tmp>/codex-home  CODEX_HOME; enthält nur `auth.json` als Symlink auf die Anmeldung
 *   <tmp>/home        HOME des Prozesses (leer), damit keine Nutzer-Skills aus ~/.agents geladen werden
 *   <tmp>/schema.json, <tmp>/antwort.txt
 *
 * Die Anmeldung wird nie gelesen oder kopiert: es entsteht nur ein Symlink, und vor dem Verlinken wird lediglich
 * geprüft, ob die Datei existiert. Nach dem Aufruf liest der Adapter die Antwortdatei und das Rollout-Log
 * (`codex-home/sessions/**\/rollout-*.jsonl`) und löscht dann alles (der Symlink wird entfernt, nicht sein Ziel).
 */

export const CODEX_COMMAND = "codex";
const AUTH_FILE = "auth.json";

/**
 * Verzeichnis, aus dem `auth.json` verlinkt wird: `CODEX_AUTH_HOME`, sonst `CODEX_HOME`, sonst `~/.codex`
 * (wie die CLI selbst).
 */
export function codexAuthHome(env: CliEnv): string {
  return env.CODEX_AUTH_HOME || env.CODEX_HOME || path.join(env.HOME || os.homedir(), ".codex");
}

/** XDG-Verzeichnisse zeigen ins echte Home; Codex soll nur das temporäre sehen. */
const DROPPED_ENV = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"];

export function codexEnv(source: CliEnv, codexHome: string, home: string): CliEnv {
  const env = isolatedEnv(source, [], { CODEX_HOME: codexHome, HOME: home });
  for (const name of DROPPED_ENV) delete env[name];
  return env;
}

export interface CodexCallInput extends Omit<CodexCall, "schemaPath" | "answerPath" | "workdir"> {
  systemPrompt: string;
  userPrompt: string;
  outputSchema: JsonSchema | null;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface CodexCallOptions {
  runCli: CliRunner;
  env: CliEnv;
  command?: string;
  /** Verzeichnis mit `auth.json`; Standard siehe `codexAuthHome`. */
  authHome?: string;
}

export interface CodexCallResult {
  cli: CliOutcome;
  /** Inhalt von `--output-last-message` (`null`, wenn die Datei fehlt). */
  lastMessage: string | null;
  /** Rollout-Log des Aufrufs (`null`, wenn keins geschrieben wurde). */
  rollout: string | null;
  /** Befehlszeile fürs Protokoll (temporäre Pfade als `<tmp>`). */
  commandLine: string;
  /** Die Anmeldung fehlte; dann wurde die CLI nicht gestartet. */
  authMissing: string | null;
}

const PREFIX = "benchmark-codex-";

export async function runCodexCall(
  input: CodexCallInput,
  options: CodexCallOptions,
): Promise<CodexCallResult> {
  const command = options.command ?? CODEX_COMMAND;
  const authSource = path.join(options.authHome ?? codexAuthHome(options.env), AUTH_FILE);
  const root = await mkdtemp(path.join(os.tmpdir(), PREFIX));
  try {
    const workdir = path.join(root, "work");
    const codexHome = path.join(root, "codex-home");
    const home = path.join(root, "home");
    await Promise.all([mkdir(workdir), mkdir(codexHome, { mode: 0o700 }), mkdir(home, { mode: 0o700 })]);
    const schemaPath = input.outputSchema ? path.join(root, "schema.json") : null;
    const answerPath = path.join(root, "antwort.txt");
    const args = buildCodexArgs({ ...input, schemaPath, answerPath, workdir });
    const commandLine = `${command} ${describeCodexArgs(args, root)}`;

    try {
      await access(authSource);
    } catch {
      return {
        cli: notStarted(),
        lastMessage: null,
        rollout: null,
        commandLine,
        authMissing: `Anmeldung nicht gefunden: ${authSource} (CODEX_AUTH_HOME prüfen)`,
      };
    }
    await symlink(authSource, path.join(codexHome, AUTH_FILE));
    if (schemaPath) await writeFile(schemaPath, JSON.stringify(input.outputSchema));

    const cli = await options.runCli({
      command,
      args,
      cwd: workdir,
      stdin: codexStdin(input.systemPrompt, input.userPrompt),
      env: codexEnv(options.env, codexHome, home),
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });
    return {
      cli,
      lastMessage: await readFile(answerPath, "utf8").catch(() => null),
      rollout: await readRollout(codexHome),
      commandLine,
      authMissing: null,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readRollout(codexHome: string): Promise<string | null> {
  const sessions = path.join(codexHome, "sessions");
  const entries = await readdir(sessions, { recursive: true }).catch(() => [] as string[]);
  const files = entries.filter((entry) => /(^|\/)rollout-[^/]*\.jsonl$/.test(entry)).sort();
  if (files.length === 0) return null;
  const texts = await Promise.all(files.map((file) => readFile(path.join(sessions, file), "utf8")));
  return texts.join("");
}

function notStarted(): CliOutcome {
  return { stdout: "", stderr: "", exitCode: null, timedOut: false, spawnError: null, durationMs: 0 };
}
