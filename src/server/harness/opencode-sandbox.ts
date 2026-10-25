import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Mode } from "@/server/prompt/benchmark-prompt";
import type { JsonSchema } from "@/server/prompt/output-schema";
import { type CliEnv, type CliOutcome, type CliRunner, isolatedEnv } from "./cli-process";
import {
  buildOpencodeArgs,
  buildOpencodeConfig,
  describeOpencodeArgs,
  opencodeSystemPrompt,
} from "./opencode-command";
import { readOpencodeStream } from "./opencode-output";

/**
 * Ein OpenCode-Aufruf in einem temporären Verzeichnis, das danach vollständig entfernt wird:
 *
 *   <tmp>/work     leeres Arbeitsverzeichnis (cwd)
 *   <tmp>/home     HOME des Prozesses (leer): keine Nutzer-Skills, AGENTS.md oder Agents aus ~/.agents, ~/.claude …
 *   <tmp>/config   XDG_CONFIG_HOME; enthält nur `opencode/opencode.json` des Adapters (Agent, Berechtigungen)
 *   <tmp>/cache, <tmp>/state, <tmp>/tmp   XDG_CACHE_HOME, XDG_STATE_HOME, TMPDIR
 *
 * Anmeldung: OpenCode v2 speichert Zugangsdaten nicht mehr in `auth.json`, sondern in seiner Datenbank im
 * Datenverzeichnis (`<XDG_DATA_HOME>/opencode/opencode.db`). Der Adapter liest oder kopiert sie nie; er lässt
 * `XDG_DATA_HOME` auf das Datenverzeichnis des Nutzers zeigen (`OPENCODE_DATA_HOME`, sonst `XDG_DATA_HOME`,
 * sonst `~/.local/share`). Deshalb entsteht die Sitzung dort: nach dem Aufruf wird sie exportiert
 * (`session export`, verlässliche Tokens und Kosten) und gelöscht (`session delete`). Ist die Sitzungs-ID im
 * Stream nicht zu finden (Absturz vor dem ersten Event), werden Sitzungen mit dem eindeutigen Titel des Aufrufs
 * über `session list` gesucht und gelöscht.
 *
 * Umgebung: nur die Grundvariablen (cli-process.ts) und die Schlüssel der Suchanbieter; Variablen der App und
 * Provider-Schlüssel des Workers bleiben draußen.
 */

export const OPENCODE_COMMAND = "opencode";

/** Umgebungsvariablen der Suchanbieter (docs websearch.mdx); werden an die CLI durchgereicht. */
export const SEARCH_PROVIDER_ENV: Record<string, string> = {
  exa: "EXA_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  parallel: "PARALLEL_API_KEY",
  tavily: "TAVILY_API_KEY",
  tinyfish: "TINYFISH_API_KEY",
};

/** Basis des Datenverzeichnisses (wie `XDG_DATA_HOME`), in dem OpenCode Anmeldung und Sitzungen hält. */
export function opencodeDataHome(env: CliEnv): string {
  return (
    env.OPENCODE_DATA_HOME || env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), ".local", "share")
  );
}

export interface OpencodeSandbox {
  root: string;
  workdir: string;
  env: CliEnv;
}

const PREFIX = "benchmark-opencode-";

/** Legt das temporäre Verzeichnis samt Konfiguration an, führt `fn` aus und löscht danach alles. */
export async function withOpencodeSandbox<T>(
  source: CliEnv,
  config: Record<string, unknown>,
  fn: (sandbox: OpencodeSandbox) => Promise<T>,
  dataHome = opencodeDataHome(source),
): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), PREFIX));
  try {
    const dirs = {
      workdir: path.join(root, "work"),
      home: path.join(root, "home"),
      config: path.join(root, "config"),
      cache: path.join(root, "cache"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
    };
    await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { mode: 0o700 })));
    await mkdir(path.join(dirs.config, "opencode"));
    await writeFile(
      path.join(dirs.config, "opencode", "opencode.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    const env = isolatedEnv(source, Object.values(SEARCH_PROVIDER_ENV), {
      HOME: dirs.home,
      XDG_CONFIG_HOME: dirs.config,
      XDG_CACHE_HOME: dirs.cache,
      XDG_STATE_HOME: dirs.state,
      XDG_DATA_HOME: dataHome,
      TMPDIR: dirs.tmp,
    });
    return await fn({ root, workdir: dirs.workdir, env });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export interface OpencodeCallInput {
  systemPrompt: string;
  userPrompt: string;
  /** `null` = ohne Schema-Anhang (Preflight-Probe). */
  outputSchema: JsonSchema | null;
  /** Formatierungsauftrag vor dem Schema; Pflicht, sobald `outputSchema` gesetzt ist. */
  formatInstruction?: string;
  model: string;
  effort: string;
  mode: Mode;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface OpencodeCallOptions {
  runCli: CliRunner;
  env: CliEnv;
  command?: string;
  /** Basis des Datenverzeichnisses; Standard siehe `opencodeDataHome`. */
  dataHome?: string;
  /** Suchanbieter im Modus mit Web (Standard `random`). */
  websearchProvider?: string | null;
}

export interface OpencodeCallResult {
  cli: CliOutcome;
  sessionId: string | null;
  /** Ausgabe von `session export` (`null`, wenn es keine Sitzung oder keinen Export gab). */
  exported: string | null;
  /** Protokoll von Export und Löschen. */
  cleanup: string[];
  /** Die Sitzung wurde gelöscht (bzw. es gab keine). */
  sessionDeleted: boolean;
  commandLine: string;
}

export const MISSING_FORMAT_INSTRUCTION =
  "Ohne Formatierungsauftrag (format-instruction.md) kann OpenCode kein Ausgabeschema bekommen";

/** Höchstdauer für `session export|list|delete`. */
const SESSION_TIMEOUT_MS = 60_000;

export async function runOpencodeCall(
  input: OpencodeCallInput,
  options: OpencodeCallOptions,
): Promise<OpencodeCallResult> {
  const command = options.command ?? OPENCODE_COMMAND;
  const title = `benchmark-mapping-${randomBytes(6).toString("hex")}`;
  if (input.outputSchema && !input.formatInstruction) throw new Error(MISSING_FORMAT_INSTRUCTION);
  const inline = input.outputSchema
    ? { formatInstruction: input.formatInstruction ?? "", outputSchema: input.outputSchema }
    : null;
  const config = buildOpencodeConfig({
    systemPrompt: opencodeSystemPrompt(input.systemPrompt, inline),
    mode: input.mode,
    websearchProvider: options.websearchProvider ?? null,
  });
  return withOpencodeSandbox(
    options.env,
    config,
    async ({ root, workdir, env }) => {
      const args = buildOpencodeArgs({ model: input.model, effort: input.effort, title });
      const commandLine = `${command} ${describeOpencodeArgs(args, root)}`;
      const cli = await options.runCli({
        command,
        args,
        cwd: workdir,
        stdin: input.userPrompt,
        env,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });
      const session = (sub: string[]) =>
        options.runCli({
          command,
          args: ["session", ...sub, "--standalone"],
          cwd: workdir,
          env,
          timeoutMs: SESSION_TIMEOUT_MS,
        });

      const cleanup: string[] = [];
      let sessionIds: string[] = [];
      const streamId = readOpencodeStream(cli.stdout).sessionId;
      if (streamId) sessionIds = [streamId];
      else if (!cli.spawnError) {
        const listed = await session(["list"]);
        sessionIds = listed.stdout
          .split("\n")
          .map((line) => line.split("\t"))
          .filter((cols) => cols[1] === title && cols[0])
          .map((cols) => cols[0]);
        cleanup.push(`Sitzungs-ID nicht im Stream; per Titel gefunden: ${sessionIds.length}`);
      }

      let exported: string | null = null;
      let sessionDeleted = true;
      for (const id of sessionIds) {
        if (exported === null) {
          const exportCli = await session(["export", id]);
          if (exportCli.exitCode === 0 && exportCli.stdout.trim()) exported = exportCli.stdout;
          else
            cleanup.push(
              `session export ${id} scheiterte (Exit-Code ${exportCli.exitCode ?? "–"}): ${(exportCli.stderr || exportCli.stdout).trim().slice(-300)}`,
            );
        }
        const deleted = await session(["delete", id]);
        if (deleted.exitCode === 0) cleanup.push(`Sitzung ${id} gelöscht`);
        else {
          sessionDeleted = false;
          cleanup.push(
            `session delete ${id} scheiterte (Exit-Code ${deleted.exitCode ?? "–"}): ${(deleted.stderr || deleted.stdout).trim().slice(-300)}`,
          );
        }
      }
      return { cli, sessionId: sessionIds[0] ?? null, exported, cleanup, sessionDeleted, commandLine };
    },
    options.dataHome,
  );
}
