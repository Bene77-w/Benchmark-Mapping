import { tmpdir } from "node:os";
import { describe, expect, test, vi } from "vitest";
import { createTestDatabase } from "@/server/db/test-database";
import type { HarnessAdapter, HarnessResult, HarnessTask } from "@/server/harness/adapter";
import { type CliOutcome, runCli } from "@/server/harness/cli-process";
import { createFakeAdapter } from "@/server/harness/fake";
import { type PreflightRequest, type PreflightResult, runPreflight } from "@/server/harness/preflight";
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

  test("verliert der Worker den Lauf vor der Probe, startet die Probe nicht", async () => {
    const { db, runId } = await setup();
    let releaseCli = () => {};
    let cliStarted = () => {};
    const started = new Promise<void>((resolve) => {
      cliStarted = resolve;
    });
    let probes = 0;
    const stale: HarnessAdapter = {
      harness: "fake",
      run: async () => {
        throw new Error("darf nicht aufgerufen werden");
      },
      preflight: (_request, options) =>
        runPreflight(
          [
            {
              id: "cli",
              label: "CLI erreichbar",
              async run() {
                cliStarted();
                await new Promise<void>((resolve) => {
                  releaseCli = resolve;
                });
                return { status: "ok", message: "da" };
              },
            },
            {
              id: "model",
              label: "Modell, Effort und Anmeldung",
              async run() {
                probes += 1;
                return { status: "ok", message: "antwortet" };
              },
            },
          ],
          () => null,
          options,
        ),
    };

    const staleWorker = processNextRun(db, { adapters: { fake: stale }, heartbeatMs: 3_600_000 });
    await started;
    expect(await processNextRun(db, { adapters: { fake: createFakeAdapter() }, staleAfterMs: 0 })).toBe(
      runId,
    );
    releaseCli();
    await staleWorker;

    expect(probes).toBe(0);
    expect((await getRun(db, runId))?.status).toBe("completed");
  });

  test("verliert der Worker während der Probe den Lauf, beendet das Abbruchsignal deren CLI-Prozess", async () => {
    const { db, runId } = await setup();
    const processes: Promise<CliOutcome>[] = [];
    const stale: HarnessAdapter = {
      harness: "fake",
      run: async (task: HarnessTask): Promise<HarnessResult> => {
        throw new Error(`darf nicht aufgerufen werden (${task.unitId})`);
      },
      preflight: async (_request, options) => {
        // Stellvertreter-Probe (Node), die sich nicht von selbst beendet.
        const cli = runCli({
          command: process.execPath,
          args: ["-e", "setTimeout(() => {}, 20000)"],
          cwd: tmpdir(),
          env: { PATH: process.env.PATH },
          timeoutMs: 60_000,
          signal: options?.signal,
        });
        processes.push(cli);
        await cli;
        return failed;
      },
    };

    const staleWorker = processNextRun(db, { adapters: { fake: stale }, heartbeatMs: 50 });
    await vi.waitFor(() => expect(processes).toHaveLength(1));
    expect(await processNextRun(db, { adapters: { fake: createFakeAdapter() }, staleAfterMs: 0 })).toBe(
      runId,
    );

    const ended = await Promise.race([
      processes[0],
      new Promise<"läuft noch">((resolve) => setTimeout(() => resolve("läuft noch"), 5_000)),
    ]);
    expect(ended).toEqual(expect.objectContaining({ aborted: true }));
    await staleWorker;
    // Der späte Preflight-Fehler des alten Workers ändert den abgeschlossenen Lauf nicht.
    expect(await getRun(db, runId)).toMatchObject({ status: "completed", error: null });
  });
});
