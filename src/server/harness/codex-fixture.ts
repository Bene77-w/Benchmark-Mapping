import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type CliFixture, HARNESS_FIXTURE_ROOT, readCliFixture } from "./cli-fixture";
import type { CliInvocation, CliOutcome, CliRunner } from "./cli-process";

/**
 * Aufnahmen der Codex-CLI (Seam 3). Zusätzlich zu `.stdout`/`.stderr`/`.meta.json` (siehe cli-fixture.ts):
 *
 *   <fall>.last-message   Inhalt der Datei von `--output-last-message` (fehlt, wenn die CLI keine schrieb)
 *   <fall>.rollout.jsonl  Rollout-Log aus dem temporären CODEX_HOME (fehlt, wenn keins entstand)
 *
 * `codexFixtureRunner` spielt eine Aufnahme ab und schreibt dabei beide Dateien an die Stellen, die der
 * Aufruf vorgibt – der Adapter liest sie wie bei der echten CLI.
 */
export interface CodexFixture extends CliFixture {
  lastMessage: string | null;
  rollout: string | null;
}

export async function codexFixture(name: string, root = HARNESS_FIXTURE_ROOT): Promise<CodexFixture> {
  const fixture = await readCliFixture("codex", name, root);
  const base = path.join(root, "codex", name);
  return {
    ...fixture,
    lastMessage: await readFile(`${base}.last-message`, "utf8").catch(() => null),
    rollout: await readFile(`${base}.rollout.jsonl`, "utf8").catch(() => null),
  };
}

export function codexFixtureRunner(
  ...fixtures: Array<Pick<CodexFixture, "outcome" | "lastMessage" | "rollout">>
): CliRunner & { calls: CliInvocation[] } {
  const calls: CliInvocation[] = [];
  const runner = async (invocation: CliInvocation): Promise<CliOutcome> => {
    calls.push(invocation);
    const fixture = fixtures[Math.min(calls.length, fixtures.length) - 1];
    if (!fixture) throw new Error("codexFixtureRunner ohne Aufnahme");
    const answerPath = invocation.args[invocation.args.indexOf("--output-last-message") + 1];
    if (fixture.lastMessage !== null && answerPath) await writeFile(answerPath, fixture.lastMessage);
    const codexHome = invocation.env.CODEX_HOME;
    if (fixture.rollout !== null && codexHome) {
      const dir = path.join(codexHome, "sessions", "2026", "10", "24");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "rollout-2026-10-24T00-00-00-aufnahme.jsonl"), fixture.rollout);
    }
    return fixture.outcome;
  };
  return Object.assign(runner, { calls });
}

/** Verzeichnis mit einer Platzhalter-`auth.json` (keine Anmeldung) für Tests. */
export async function fakeAuthHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchmark-codex-auth-"));
  await writeFile(path.join(dir, "auth.json"), '{"hinweis":"Platzhalter für Tests"}\n');
  return dir;
}
