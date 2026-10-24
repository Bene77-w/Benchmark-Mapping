import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/database";
import { createTestDatabase } from "@/server/db/test-database";
import type { Snapshot } from "@/server/snapshot/model";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { addGoldUnit, getGoldDraft, removeGoldUnit, setGoldUnitCategory } from "./store";

/**
 * Seam 1 – Gold-Erstellung über die Schnittstelle des Gold-Moduls, mit Test-Datenbank und echtem Snapshot.
 */

const AVIATION = "house--transportation-and-infrastructure--aviation";
const ETHICS = "house--ethics";

let snapshot: Snapshot;
beforeAll(async () => {
  snapshot = await readSnapshotFile(SNAPSHOT_PATH);
});

async function databaseWithSnapshot(): Promise<Database> {
  const db = await createTestDatabase();
  await loadSnapshot(db, snapshot);
  return db;
}

describe("Gold-Units auswählen", { timeout: 30_000 }, () => {
  test("ohne Auswahl gibt es keinen Entwurf", async () => {
    const db = await databaseWithSnapshot();
    expect(await getGoldDraft(db)).toBeNull();
  });

  test("Units mit Kategorie aufnehmen, Kategorie ändern und wieder entfernen", async () => {
    const db = await databaseWithSnapshot();
    await addGoldUnit(db, { unitId: AVIATION, category: "a" });
    await addGoldUnit(db, { unitId: ETHICS, category: "c" });
    await setGoldUnitCategory(db, AVIATION, "f");

    const draft = await getGoldDraft(db);
    expect(draft?.snapshotHash).toBe(snapshot.contentHash);
    expect(
      draft?.units.map(({ unitId, category, noMapping, industries }) => ({
        unitId,
        category,
        noMapping,
        industries,
      })),
    ).toEqual([
      { unitId: ETHICS, category: "c", noMapping: false, industries: [] },
      { unitId: AVIATION, category: "f", noMapping: false, industries: [] },
    ]);

    await removeGoldUnit(db, ETHICS);
    expect((await getGoldDraft(db))?.units.map((unit) => unit.unitId)).toEqual([AVIATION]);
  });

  test("lehnt unbekannte, doppelte und mehr als 30 Units ab", async () => {
    const db = await databaseWithSnapshot();
    await expect(addGoldUnit(db, { unitId: "gibt-es-nicht", category: "a" })).rejects.toThrow(
      /gibt-es-nicht/,
    );
    await addGoldUnit(db, { unitId: AVIATION, category: "a" });
    await expect(addGoldUnit(db, { unitId: AVIATION, category: "b" })).rejects.toThrow(/bereits/);

    const others = snapshot.units.map((unit) => unit.unitId).filter((id) => id !== AVIATION);
    for (const unitId of others.slice(0, 29)) await addGoldUnit(db, { unitId, category: "b" });
    expect((await getGoldDraft(db))?.units).toHaveLength(30);
    await expect(addGoldUnit(db, { unitId: others[29], category: "b" })).rejects.toThrow(/30/);
  });
});
