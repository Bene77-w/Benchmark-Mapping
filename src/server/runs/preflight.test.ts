import { describe, expect, test } from "vitest";
import { createTestDatabase } from "@/server/db/test-database";
import type { HarnessAdapter } from "@/server/harness/adapter";
import { createFakeAdapter } from "@/server/harness/fake";
import type { PreflightRequest, PreflightResult } from "@/server/harness/preflight";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { processNextRun } from "./runner";
import { createRun, getRun } from "./store";

/** Seam 1 – Preflight vor jedem Lauf: Ergebnis am Lauf gespeichert, Fehler blockieren die Ausführung. */

const UNITS = ["house--ethics", "joint--joint-economic-committee"];

async function setup() {
  const db = await createTestDatabase();
  await loadSnapshot(db, await readSnapshotFile(SNAPSHOT_PATH));
  const { runId } = await createRun(db, {
    configuration: { harness: "fake", model: "standard", effort: "low", mode: "web" },
    unitIds: UNITS,
  });
  return { db, runId };
}

function withPreflight(result: PreflightResult) {
  const fake = createFakeAdapter();
  const requests: PreflightRequest[] = [];
  let calls = 0;
  const adapter: HarnessAdapter = {
    harness: "fake",
    run: (task) => {
      calls += 1;
      return fake.run(task);
    },
    preflight: async (request) => {
      requests.push(request);
      return result;
    },
  };
  return { adapter, requests, calls: () => calls };
}

const passed: PreflightResult = {
  ok: true,
  checkedAt: "2026-10-24T08:00:00.000Z",
  cliVersion: "2.1.310",
  checks: [{ id: "cli", label: "CLI erreichbar", status: "ok", message: "Claude Code 2.1.310" }],
};
const failed: PreflightResult = {
  ok: false,
  checkedAt: "2026-10-24T08:00:00.000Z",
  cliVersion: "2.1.310",
  checks: [
    { id: "cli", label: "CLI erreichbar", status: "ok", message: "Claude Code 2.1.310" },
    { id: "model", label: "Modell, Effort und Anmeldung", status: "failed", message: "Modell unbekannt" },
  ],
};

describe("Preflight vor dem Lauf", { timeout: 30_000 }, () => {
  test("ein bestandener Preflight wird am Lauf gespeichert, danach laufen die Units", async () => {
    const { db, runId } = await setup();
    const { adapter, requests, calls } = withPreflight(passed);

    await processNextRun(db, { adapters: { fake: adapter } });

    const run = await getRun(db, runId);
    expect(requests).toEqual([{ model: "standard", effort: "low", mode: "web" }]);
    expect(run?.preflight).toEqual(passed);
    expect(run?.status).toBe("completed");
    expect(calls()).toBe(2);
  });

  test("ein fehlgeschlagener Preflight blockiert den Lauf mit klarer Meldung, ohne Units aufzurufen", async () => {
    const { db, runId } = await setup();
    const { adapter, calls } = withPreflight(failed);

    await processNextRun(db, { adapters: { fake: adapter } });

    const run = await getRun(db, runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("Preflight fehlgeschlagen: Modell, Effort und Anmeldung: Modell unbekannt");
    expect(run?.preflight).toEqual(failed);
    expect(run?.progress).toMatchObject({ pending: 2, running: 0 });
    expect(calls()).toBe(0);
  });

  test("Fake-Harness: unbekanntes Szenario scheitert im Preflight", async () => {
    const db = await createTestDatabase();
    await loadSnapshot(db, await readSnapshotFile(SNAPSHOT_PATH));
    const { runId } = await createRun(db, {
      configuration: { harness: "fake", model: "gibt-es-nicht", effort: "low", mode: "text_only" },
      unitIds: UNITS,
    });

    await processNextRun(db, { adapters: { fake: createFakeAdapter() } });

    const run = await getRun(db, runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("Szenario gibt-es-nicht");
    expect(run?.preflight?.checks).toEqual([expect.objectContaining({ id: "scenario", status: "failed" })]);
  });
});
