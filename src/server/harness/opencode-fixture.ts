import { readFile } from "node:fs/promises";
import path from "node:path";
import { type CliFixture, cliOutcome, HARNESS_FIXTURE_ROOT, readCliFixture } from "./cli-fixture";
import type { CliInvocation, CliOutcome, CliRunner } from "./cli-process";

/**
 * Aufnahmen der OpenCode-CLI (Seam 3). Zusätzlich zu `.stdout`/`.stderr`/`.meta.json` (siehe cli-fixture.ts):
 *
 *   <fall>.export.json   Ausgabe von `opencode session export <id>` (fehlt, wenn es keine Sitzung gab)
 *
 * `opencodeFixtureRunner` spielt eine Aufnahme ab: `run` liefert der Reihe nach die Aufnahmen, `session export`
 * den Export der zuletzt abgespielten (die geschriebene Konfiguration landet in `configs`), `session delete`/`session list` und `--version` feste Antworten,
 * `auth list` die angegebene Liste. Alle Aufrufe werden mitgeschrieben.
 */
export interface OpencodeFixture extends CliFixture {
  exported: string | null;
}

export async function opencodeFixture(name: string, root = HARNESS_FIXTURE_ROOT): Promise<OpencodeFixture> {
  const fixture = await readCliFixture("opencode", name, root);
  const exported = await readFile(path.join(root, "opencode", `${name}.export.json`), "utf8").catch(
    () => null,
  );
  return { ...fixture, exported };
}

export interface OpencodeReplayOptions {
  /** stdout von `opencode --version`. */
  version?: string;
  /** Integrationen für `auth list --format json` (nur IDs). */
  integrations?: string[];
  /** Ergebnis von `session delete`; eine Liste der Reihe nach (das letzte wiederholt sich). */
  deleteOutcome?: CliOutcome | CliOutcome[];
  /** stdout von `session list` (erhält den Titel des letzten `run`). */
  listSessions?: (title: string) => string;
}

export function opencodeFixtureRunner(
  fixtures: Array<Pick<OpencodeFixture, "outcome" | "exported">>,
  options: OpencodeReplayOptions = {},
): CliRunner & { calls: CliInvocation[]; runs: CliInvocation[]; configs: Array<Record<string, unknown>> } {
  const calls: CliInvocation[] = [];
  const runs: CliInvocation[] = [];
  const configs: Array<Record<string, unknown>> = [];
  let title = "";
  let deletes = 0;
  let current: Pick<OpencodeFixture, "outcome" | "exported"> | null = null;
  const runner = async (invocation: CliInvocation): Promise<CliOutcome> => {
    calls.push(invocation);
    const [first, second] = invocation.args;
    if (first === "--version") return cliOutcome({ stdout: options.version ?? "opencode v2.1.4\n" });
    if (first === "auth" && second === "list") {
      const list = (options.integrations ?? []).map((id) => ({ id, name: id, connections: [] }));
      return cliOutcome({ stdout: JSON.stringify(list) });
    }
    if (first === "session" && second === "export") {
      if (current?.exported) return cliOutcome({ stdout: current.exported });
      return cliOutcome({ exitCode: 1, stderr: "Session not found" });
    }
    if (first === "session" && second === "delete") {
      const outcomes = [options.deleteOutcome ?? cliOutcome()].flat();
      deletes += 1;
      return outcomes[Math.min(deletes, outcomes.length) - 1];
    }
    if (first === "session" && second === "list")
      return cliOutcome({ stdout: options.listSessions?.(title) ?? "" });
    if (first !== "run")
      throw new Error(`opencodeFixtureRunner: unerwarteter Aufruf ${invocation.args.join(" ")}`);
    runs.push(invocation);
    title = invocation.args[invocation.args.indexOf("--title") + 1] ?? "";
    const configPath = path.join(invocation.env.XDG_CONFIG_HOME ?? "", "opencode", "opencode.json");
    configs.push(JSON.parse(await readFile(configPath, "utf8")));
    current = fixtures[Math.min(runs.length, fixtures.length) - 1] ?? null;
    if (!current) throw new Error("opencodeFixtureRunner ohne Aufnahme");
    return current.outcome;
  };
  return Object.assign(runner, { calls, runs, configs });
}
