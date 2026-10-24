import { type AdapterRegistry, HARNESSES, type Harness, type HarnessAdapter } from "./adapter";
import { createClaudeCodeAdapter } from "./claude-code";
import { createCodexAdapter } from "./codex";
import { createFakeAdapter } from "./fake";

/**
 * Die Adapter, mit denen der Worker Läufe ausführt; je Harness eine Fabrik. Ein Harness ohne Fabrik ist in
 * der GUI nicht wählbar, und seine Läufe werden als nicht ausführbar markiert. Neue Adapter: eine Zeile hier.
 *
 * Umgebung: `FAKE_HARNESS_ROOT` (Szenario-Verzeichnis des Fake-Harness, Standard `tests/fixtures/fake-harness`),
 * `CLAUDE_CODE_COMMAND` (Name oder Pfad der Claude-Code-CLI, Standard `claude`), `CODEX_COMMAND` (Standard
 * `codex`), `CODEX_AUTH_HOME` (Verzeichnis, aus dem `auth.json` verlinkt wird; Standard `CODEX_HOME` bzw.
 * `~/.codex`) und `CODEX_EXPECTED_PLAN` (geforderter `plan_type` im Preflight, Standard `plus`).
 */
const FACTORIES: Partial<Record<Harness, (env: NodeJS.ProcessEnv) => HarnessAdapter>> = {
  claude_code: (env) => createClaudeCodeAdapter({ command: env.CLAUDE_CODE_COMMAND, env }),
  codex: (env) =>
    createCodexAdapter({
      command: env.CODEX_COMMAND,
      env,
      expectedPlan: env.CODEX_EXPECTED_PLAN || undefined,
    }),
  fake: (env) => createFakeAdapter({ root: env.FAKE_HARNESS_ROOT }),
};

export function createAdapterRegistry(env: NodeJS.ProcessEnv = process.env): AdapterRegistry {
  return Object.fromEntries(
    Object.entries(FACTORIES).map(([harness, factory]) => [harness, factory(env)]),
  ) as AdapterRegistry;
}

/** Harnesses, für die es einen Adapter gibt (Auswahl in der GUI). */
export const AVAILABLE_HARNESSES: readonly Harness[] = HARNESSES.filter((harness) => harness in FACTORIES);
