import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/database";
import { createTestDatabase } from "@/server/db/test-database";
import { createRun, createRunFromConfiguration, getRun } from "@/server/runs/store";
import type { GoldUnit } from "@/server/scoring/model";
import type { Snapshot } from "@/server/snapshot/model";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { listStartableGold, requireGold } from "./active";
import { addGoldUnit, finalizeGoldDraft, saveGoldUnitDecision, startGoldDraftFromVersion } from "./store";
import { readTestGold } from "./test-gold";

/**
 * Seam 1 – Gold-Version beim Laufstart wählen: zwei eingefrorene Gold-Versionen, ein Lauf über die Units der
 * gewählten Version, die am Lauf gespeichert bleibt.
 */

const AVIATION = "house--transportation-and-infrastructure--aviation";
const ETHICS = "house--ethics";
const LIVESTOCK = "house--agriculture--livestock-dairy-and-poultry";
const fakeConfiguration = { harness: "fake", model: "standard", effort: "high", mode: "text_only" } as const;

let snapshot: Snapshot;
let testGoldUnits: GoldUnit[];
beforeAll(async () => {
  snapshot = await readSnapshotFile(SNAPSHOT_PATH);
  testGoldUnits = (await readTestGold()).units;
});

async function addTestGoldUnit(db: Database, unitId: string): Promise<void> {
  const unit = testGoldUnits.find((entry) => entry.unitId === unitId);
  if (!unit) throw new Error(`${unitId} fehlt im Test-Gold`);
  await addGoldUnit(db, { unitId, category: unit.category });
  await saveGoldUnitDecision(db, unitId, { ...unit, note: null });
}

/** gold-v1 mit Aviation und Ethics, gold-v2 zusätzlich mit Livestock. */
async function databaseWithTwoGoldVersions(): Promise<Database> {
  const db = await createTestDatabase();
  await loadSnapshot(db, snapshot);
  await addTestGoldUnit(db, AVIATION);
  await addTestGoldUnit(db, ETHICS);
  await finalizeGoldDraft(db);
  await startGoldDraftFromVersion(db, "gold-v1");
  await addTestGoldUnit(db, LIVESTOCK);
  await finalizeGoldDraft(db);
  return db;
}

async function runOnGold(db: Database, version?: string) {
  const gold = await requireGold(db, version);
  const { runId } = await createRun(db, {
    configuration: fakeConfiguration,
    unitIds: gold.units.map((unit) => unit.unitId),
    goldVersion: gold.version,
  });
  return getRun(db, runId);
}

describe("Gold-Version beim Laufstart", { timeout: 30_000 }, () => {
  test("zur Auswahl stehen alle eingefrorenen Gold-Versionen, neueste zuerst", async () => {
    const db = await databaseWithTwoGoldVersions();
    expect(await listStartableGold(db)).toEqual([
      { version: "gold-v2", unitCount: 3 },
      { version: "gold-v1", unitCount: 2 },
    ]);
  });

  test("ein Lauf über eine ältere Gold-Version nimmt deren Units und merkt sich die Version", async () => {
    const db = await databaseWithTwoGoldVersions();
    const run = await runOnGold(db, "gold-v1");
    expect(run?.goldVersion).toBe("gold-v1");
    expect(run?.units.map((unit) => unit.unitId)).toEqual([ETHICS, AVIATION]);
  });

  test("ohne Auswahl gilt die neueste Gold-Version", async () => {
    const db = await databaseWithTwoGoldVersions();
    const run = await runOnGold(db);
    expect(run?.goldVersion).toBe("gold-v2");
    expect(run?.units).toHaveLength(3);
  });

  test("eine unbekannte Gold-Version ist ein Fehler", async () => {
    const db = await databaseWithTwoGoldVersions();
    await expect(requireGold(db, "gold-v9")).rejects.toThrow(/gold-v9/);
  });

  test("„Erneut starten“ merkt sich die Gold-Version des neuen Laufs", async () => {
    const db = await databaseWithTwoGoldVersions();
    const first = await runOnGold(db, "gold-v1");
    const gold = await requireGold(db);
    const { runId } = await createRunFromConfiguration(
      db,
      first?.configuration.id ?? 0,
      gold.units.map((unit) => unit.unitId),
      { goldVersion: gold.version },
    );
    expect((await getRun(db, runId))?.goldVersion).toBe("gold-v2");
  });
});
