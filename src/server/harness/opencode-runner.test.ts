import { describe, expect, test } from "vitest";
import { createTestDatabase } from "@/server/db/test-database";
import { processNextRun } from "@/server/runs/runner";
import { createRun, getRun } from "@/server/runs/store";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { createOpencodeAdapter } from "./opencode";
import { opencodeFixture, opencodeFixtureRunner } from "./opencode-fixture";

/**
 * OpenCode im Runner (Seam 1 mit dem echten Adapter und abgespielten Aufnahmen): Das Schema steht bei OpenCode
 * nur im Prompt, eine schemawidrige Antwort ist deshalb möglich. Sie führt zum Wiederholversuch und, wenn auch
 * dieser schemawidrig ist, zum Format-Fehler.
 */
describe("OpenCode-Adapter im Runner", { timeout: 30_000 }, () => {
  test("schemawidrige Antwort: Preflight, ein Wiederholversuch, danach Format-Fehler; Sitzungen gelöscht", async () => {
    const db = await createTestDatabase();
    await loadSnapshot(db, await readSnapshotFile(SNAPSHOT_PATH));
    const runner = opencodeFixtureRunner([await opencodeFixture("schemawidrig")], {
      integrations: ["deepseek"],
    });
    const { runId } = await createRun(db, {
      configuration: {
        harness: "opencode",
        model: "deepseek/deepseek-flash",
        effort: "default",
        mode: "text_only",
      },
      unitIds: ["house--ethics"],
    });

    await processNextRun(db, { adapters: { opencode: createOpencodeAdapter({ runCli: runner, env: {} }) } });

    const run = await getRun(db, runId);
    expect(run?.status).toBe("completed");
    expect(run?.preflight?.ok).toBe(true);
    expect(run?.units[0]).toMatchObject({
      status: "failed",
      attempts: 2,
      answer: null,
      error: { kind: "schema_violation" },
      effort: { reported: "default", confirmed: true },
      nativeCostUsd: 2 * 0.0018618,
    });
    // Probe des Preflights + zwei Versuche; jede Sitzung wurde exportiert und gelöscht.
    expect(runner.runs).toHaveLength(3);
    expect(runner.calls.filter((call) => call.args[1] === "delete")).toHaveLength(3);
  });
});
