import { type AdapterRegistry, HARNESSES, type Harness, type HarnessAdapter } from "./adapter";
import { createFakeAdapter } from "./fake";

/**
 * Die Adapter, mit denen der Worker Läufe ausführt; je Harness eine Fabrik. Ein Harness ohne Fabrik ist in
 * der GUI nicht wählbar, und seine Läufe werden als nicht ausführbar markiert. Neue Adapter: eine Zeile hier.
 *
 * Umgebung: `FAKE_HARNESS_ROOT` (Szenario-Verzeichnis des Fake-Harness, Standard `tests/fixtures/fake-harness`).
 */
const FACTORIES: Partial<Record<Harness, (env: NodeJS.ProcessEnv) => HarnessAdapter>> = {
  fake: (env) => createFakeAdapter({ root: env.FAKE_HARNESS_ROOT }),
};

export function createAdapterRegistry(env: NodeJS.ProcessEnv = process.env): AdapterRegistry {
  return Object.fromEntries(
    Object.entries(FACTORIES).map(([harness, factory]) => [harness, factory(env)]),
  ) as AdapterRegistry;
}

/** Harnesses, für die es einen Adapter gibt (Auswahl in der GUI). */
export const AVAILABLE_HARNESSES: readonly Harness[] = HARNESSES.filter((harness) => harness in FACTORIES);
