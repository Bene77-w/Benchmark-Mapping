import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CliInvocation, CliOutcome, CliRunner } from "./cli-process";

/**
 * Aufgezeichnete CLI-Ausgaben für die Adapter-Tests (Seam 3). Ablage je Harness:
 *
 *   tests/fixtures/harness/<harness>/<fall>.stdout     Rohausgabe (bereinigt, siehe Aufnahmeskript)
 *   tests/fixtures/harness/<harness>/<fall>.stderr     optional
 *   tests/fixtures/harness/<harness>/<fall>.meta.json  Aufnahme: Datum, Aufruf, Aufgabe, Exit-Code, Timeout,
 *                                                      `constructed` (true = nicht echt aufgezeichnet) + `note`
 *
 * `fixtureRunner` spielt einen Fall als `CliRunner` ab; der Adapter läuft dabei unverändert, nur ohne Prozess.
 */
export const HARNESS_FIXTURE_ROOT = "tests/fixtures/harness";

export const fixtureMetaSchema = z.object({
  recordedAt: z.string(),
  constructed: z.boolean(),
  note: z.string().optional(),
  command: z.string(),
  task: z.object({ unitId: z.string(), model: z.string(), effort: z.string(), mode: z.string() }).loose(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number().nonnegative(),
});
export type FixtureMeta = z.infer<typeof fixtureMetaSchema>;

export interface CliFixture {
  meta: FixtureMeta;
  outcome: CliOutcome;
}

export async function readCliFixture(
  harness: string,
  name: string,
  root = HARNESS_FIXTURE_ROOT,
): Promise<CliFixture> {
  const base = path.join(root, harness, name);
  const meta = fixtureMetaSchema.parse(JSON.parse(await readFile(`${base}.meta.json`, "utf8")));
  const stdout = await readFile(`${base}.stdout`, "utf8");
  const stderr = await readFile(`${base}.stderr`, "utf8").catch(() => "");
  return {
    meta,
    outcome: {
      stdout,
      stderr,
      exitCode: meta.exitCode,
      timedOut: meta.timedOut,
      spawnError: null,
      durationMs: meta.durationMs,
    },
  };
}

/** Ein `CliRunner`, der die Aufrufe mitschreibt und der Reihe nach die angegebenen Ergebnisse liefert. */
export function scriptedRunner(...outcomes: CliOutcome[]): CliRunner & { calls: CliInvocation[] } {
  const calls: CliInvocation[] = [];
  const runner = async (invocation: CliInvocation) => {
    calls.push(invocation);
    const outcome = outcomes[Math.min(calls.length, outcomes.length) - 1];
    if (!outcome) throw new Error("scriptedRunner ohne Ergebnis");
    return outcome;
  };
  return Object.assign(runner, { calls });
}

/** Ergebnis eines Aufrufs ohne Ausgabe, z. B. für Timeout oder Startfehler. */
export function cliOutcome(overrides: Partial<CliOutcome> = {}): CliOutcome {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    spawnError: null,
    durationMs: 0,
    ...overrides,
  };
}
