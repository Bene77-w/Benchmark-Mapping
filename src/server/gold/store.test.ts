import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/database";
import { createTestDatabase } from "@/server/db/test-database";
import type { Snapshot } from "@/server/snapshot/model";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { GoldValidationError } from "./model";
import {
  addGoldUnit,
  checkGoldDraft,
  finalizeGoldDraft,
  getGoldDraft,
  getGoldVersion,
  getLatestGoldVersion,
  removeGoldUnit,
  saveGoldUnitDecision,
  setGoldUnitCategory,
} from "./store";

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

describe("Gold-Review abschließen", { timeout: 30_000 }, () => {
  async function draftWithTwoUnits(): Promise<Database> {
    const db = await databaseWithSnapshot();
    await addGoldUnit(db, { unitId: AVIATION, category: "a" });
    await addGoldUnit(db, { unitId: ETHICS, category: "c" });
    return db;
  }

  test("blockiert bei fehlender Entscheidung, zu vielen vertretbaren und no_mapping mit Industries", async () => {
    const db = await draftWithTwoUnits();
    expect((await checkGoldDraft(db)).map(({ kind, unitId }) => ({ kind, unitId }))).toEqual([
      { kind: "missing_decision", unitId: ETHICS },
      { kind: "missing_decision", unitId: AVIATION },
    ]);

    await saveGoldUnitDecision(db, ETHICS, {
      category: "c",
      noMapping: true,
      note: null,
      industries: [{ industryId: "airlines", class: "vertretbar", webOnly: false }],
    });
    await saveGoldUnitDecision(db, AVIATION, {
      category: "a",
      noMapping: false,
      note: null,
      industries: [
        { industryId: "airlines", class: "positiv", webOnly: false },
        { industryId: "aerospace-defense", class: "vertretbar", webOnly: false },
        { industryId: "airports-air-services", class: "vertretbar", webOnly: false },
        { industryId: "travel-services", class: "vertretbar", webOnly: true },
      ],
    });
    expect((await checkGoldDraft(db)).map(({ kind, unitId }) => ({ kind, unitId }))).toEqual([
      { kind: "no_mapping_with_industries", unitId: ETHICS },
      { kind: "too_many_vertretbar", unitId: AVIATION },
    ]);
    const rejected = await finalizeGoldDraft(db).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(GoldValidationError);
    expect((rejected as GoldValidationError).issues).toHaveLength(2);
    expect(await getLatestGoldVersion(db)).toBeNull();
  });

  test("lehnt unbekannte Industries beim Speichern ab", async () => {
    const db = await draftWithTwoUnits();
    await expect(
      saveGoldUnitDecision(db, AVIATION, {
        category: "a",
        noMapping: false,
        note: null,
        industries: [{ industryId: "gibt-es-nicht", class: "positiv", webOnly: false }],
      }),
    ).rejects.toThrow(/gibt-es-nicht/);
  });

  test("der Abschluss friert gold-v1 ein; weitere Änderungen betreffen nur einen neuen Entwurf", async () => {
    const db = await draftWithTwoUnits();
    await saveGoldUnitDecision(db, ETHICS, {
      category: "c",
      noMapping: true,
      note: "Abgeordnetenverhalten, keine Industry",
      industries: [],
    });
    await saveGoldUnitDecision(db, AVIATION, {
      category: "f",
      noMapping: false,
      note: null,
      industries: [
        { industryId: "airports-air-services", class: "positiv", webOnly: false },
        { industryId: "airlines", class: "positiv", webOnly: false },
        { industryId: "aerospace-defense", class: "vertretbar", webOnly: true },
      ],
    });
    expect(await checkGoldDraft(db)).toEqual([]);

    const { label } = await finalizeGoldDraft(db);
    expect(label).toBe("gold-v1");
    expect(await getGoldDraft(db)).toBeNull();

    const expectedUnits = [
      {
        unitId: ETHICS,
        category: "c",
        noMapping: true,
        note: "Abgeordnetenverhalten, keine Industry",
        industries: [],
      },
      {
        unitId: AVIATION,
        category: "f",
        noMapping: false,
        note: null,
        industries: [
          { industryId: "aerospace-defense", class: "vertretbar", webOnly: true },
          { industryId: "airlines", class: "positiv", webOnly: false },
          { industryId: "airports-air-services", class: "positiv", webOnly: false },
        ],
      },
    ];
    const frozen = await getGoldVersion(db, "gold-v1");
    expect(frozen).toMatchObject({ label: "gold-v1", status: "frozen", snapshotHash: snapshot.contentHash });
    expect(frozen?.frozenAt).toBeInstanceOf(Date);
    expect(frozen?.units).toEqual(expectedUnits);
    expect((await getLatestGoldVersion(db))?.label).toBe("gold-v1");

    // Änderungen nach dem Abschluss gehen in einen neuen Entwurf, gold-v1 bleibt unverändert.
    await expect(removeGoldUnit(db, ETHICS)).rejects.toThrow(/Entwurf/);
    await addGoldUnit(db, { unitId: ETHICS, category: "b" });
    expect((await getGoldVersion(db, "gold-v1"))?.units).toEqual(expectedUnits);
  });
});
