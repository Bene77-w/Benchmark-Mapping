import { expect, test } from "vitest";
import { createTestDatabase } from "@/server/db/test-database";
import { createFakeAdapter } from "@/server/harness/fake";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { createRun, getRun } from "./store";
import { runWorker } from "./worker";

test(
  "der Worker arbeitet wartende Läufe nacheinander ab, auch später angelegte, bis er gestoppt wird",
  { timeout: 30_000 },
  async () => {
    const db = await createTestDatabase();
    await loadSnapshot(db, await readSnapshotFile(SNAPSHOT_PATH));
    const configuration = { harness: "fake", model: "standard", effort: "high", mode: "text_only" } as const;
    const first = await createRun(db, { configuration, unitIds: ["house--ethics"] });

    const stop = new AbortController();
    const worker = runWorker(
      db,
      { adapters: { fake: createFakeAdapter() } },
      { pollIntervalMs: 20, signal: stop.signal },
    );
    await expect
      .poll(async () => (await getRun(db, first.runId))?.status, { timeout: 20_000 })
      .toBe("completed");

    const second = await createRun(db, {
      configuration,
      unitIds: ["house--agriculture--livestock-dairy-and-poultry"],
    });
    await expect
      .poll(async () => (await getRun(db, second.runId))?.status, { timeout: 20_000 })
      .toBe("completed");

    stop.abort();
    await worker;
  },
);
