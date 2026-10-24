import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/database";
import { createTestDatabase } from "@/server/db/test-database";
import { readTestGold } from "@/server/gold/test-gold";
import { createFakeAdapter } from "@/server/harness/fake";
import { processNextRun } from "@/server/runs/runner";
import { createRun } from "@/server/runs/store";
import type { Snapshot } from "@/server/snapshot/model";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import type { GoldVersion } from "./model";
import { ensureEvaluation, listEvaluations } from "./store";

/**
 * Speicherung der Bewertung je (Lauf, Gold-Version) über die Schnittstelle des Kerns (wie Seam 1):
 * Lauf mit Fake-Harness ausführen, dann bewerten.
 */

const fakeConfiguration = { harness: "fake", model: "standard", effort: "high", mode: "text_only" } as const;

let snapshot: Snapshot;
let testGold: GoldVersion;
beforeAll(async () => {
  snapshot = await readSnapshotFile(SNAPSHOT_PATH);
  testGold = await readTestGold();
});

async function completedRun(): Promise<{ db: Database; runId: number }> {
  const db = await createTestDatabase();
  await loadSnapshot(db, snapshot);
  const { runId } = await createRun(db, {
    configuration: fakeConfiguration,
    unitIds: testGold.units.map((unit) => unit.unitId),
  });
  await processNextRun(db, { adapters: { fake: createFakeAdapter() } });
  return { db, runId };
}

describe("Bewertung speichern", { timeout: 30_000 }, () => {
  test("bewertet einen abgeschlossenen Lauf gegen das Gold und speichert das Ergebnis einmal", async () => {
    const { db, runId } = await completedRun();

    const evaluation = await ensureEvaluation(db, runId, testGold);
    // Fake-Antworten: Aviation 1, Livestock 2/3, Ethics 1, Veterans invalid_json 0, JEC (no_mapping-Gold) 0.
    expect(evaluation).toMatchObject({
      goldVersion: "test-gold",
      mode: "text_only",
      complete: true,
      formatErrors: 1,
      harnessFailures: 0,
      evidenceFidelity: 1,
    });
    expect(evaluation?.score).toBeCloseTo((1 + 2 / 3 + 1) / 5, 10);
    expect(Object.values(evaluation?.violations ?? {}).every((count) => count === 0)).toBe(true);
    expect(evaluation?.categories.map((entry) => entry.category)).toEqual(["a", "b", "c", "d"]);

    const [stored] = await listEvaluations(db, runId);
    expect(stored).toMatchObject({ goldVersion: "test-gold", complete: true, formatErrors: 1 });
    expect(stored.score).toBeCloseTo(evaluation?.score ?? Number.NaN, 10);
    expect(stored.interval).toEqual(evaluation?.interval);

    expect(await ensureEvaluation(db, runId, testGold)).toEqual(evaluation);
    const again = await listEvaluations(db, runId);
    expect(again).toHaveLength(1);
    expect(again[0].evaluatedAt).toEqual(stored.evaluatedAt);
  });

  test("je Gold-Version eine eigene Bewertung; fehlende Units machen den Lauf unvollständig", async () => {
    const { db, runId } = await completedRun();
    await ensureEvaluation(db, runId, testGold);
    const newer: GoldVersion = {
      version: "gold-v2",
      units: [
        ...testGold.units.filter((unit) => unit.unitId !== "joint--joint-economic-committee"),
        { unitId: "house--ways-and-means--health", category: "b", noMapping: true, industries: [] },
      ],
    };

    const evaluation = await ensureEvaluation(db, runId, newer);
    expect(evaluation).toMatchObject({
      goldVersion: "gold-v2",
      complete: false,
      missingUnitIds: ["house--ways-and-means--health"],
      score: null,
    });
    expect((await listEvaluations(db, runId)).map((entry) => [entry.goldVersion, entry.complete])).toEqual([
      ["gold-v2", false],
      ["test-gold", true],
    ]);
  });

  test("geänderter Gold-Inhalt unter derselben Version wird neu bewertet", async () => {
    const { db, runId } = await completedRun();
    await ensureEvaluation(db, runId, testGold);
    const changed: GoldVersion = {
      ...testGold,
      units: testGold.units.map((unit) =>
        unit.unitId === "joint--joint-economic-committee"
          ? {
              ...unit,
              noMapping: false,
              industries: [{ industryId: "banks-regional", class: "positiv", webOnly: false }],
            }
          : unit,
      ),
    };

    const evaluation = await ensureEvaluation(db, runId, changed);
    expect(evaluation?.score).toBeCloseTo((1 + 2 / 3 + 1 + 1) / 5, 10);
    const stored = await listEvaluations(db, runId);
    expect(stored).toHaveLength(1);
    expect(stored[0].score).toBeCloseTo((1 + 2 / 3 + 1 + 1) / 5, 10);
  });

  test("ein noch nicht abgeschlossener Lauf wird bewertet, aber nicht gespeichert", async () => {
    const db = await createTestDatabase();
    await loadSnapshot(db, snapshot);
    const { runId } = await createRun(db, {
      configuration: fakeConfiguration,
      unitIds: testGold.units.map((unit) => unit.unitId),
    });

    const evaluation = await ensureEvaluation(db, runId, testGold);
    expect(evaluation).toMatchObject({ complete: false, score: null });
    expect(evaluation?.missingUnitIds).toHaveLength(5);
    expect(await listEvaluations(db, runId)).toEqual([]);
    expect(await ensureEvaluation(db, runId + 1, testGold)).toBeNull();
  });
});
