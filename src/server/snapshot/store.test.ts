import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/database";
import { createTestDatabase } from "@/server/db/test-database";
import type { Snapshot } from "./model";
import { readSnapshotFile, SNAPSHOT_PATH } from "./snapshot-file";
import { getCurrentSnapshot, getSnapshotContent, loadSnapshot, searchIndustries, searchUnits } from "./store";

let snapshot: Snapshot;
beforeAll(async () => {
  snapshot = await readSnapshotFile(SNAPSHOT_PATH);
});

async function loadedDatabase(): Promise<Database> {
  const db = await createTestDatabase();
  await loadSnapshot(db, snapshot);
  return db;
}

// Voller Snapshot in PGlite: unter Parallelbetrieb länger als der Standard.
describe("Snapshot in der Datenbank", { timeout: 30_000 }, () => {
  test("lädt den Snapshot genau einmal, auch wenn er erneut geladen wird", async () => {
    const db = await createTestDatabase();
    expect(await getCurrentSnapshot(db)).toBeNull();

    const first = await loadSnapshot(db, snapshot);
    const second = await loadSnapshot(db, snapshot);

    expect(first.created).toBe(true);
    expect(second).toEqual({ snapshotId: first.snapshotId, created: false });
    expect(await getCurrentSnapshot(db)).toMatchObject({
      version: "snapshot-v1",
      contentHash: snapshot.contentHash,
      unitCount: 225,
      nameOnlyCount: 9,
      industryCount: 145,
      cleanupCount: snapshot.cleanups.length,
    });
  });

  test("findet Units über Name, Committee und Zuständigkeitstext und zeigt ihre Bereinigungen", async () => {
    const db = await loadedDatabase();

    const all = await searchUnits(db, {});
    expect(all).toHaveLength(225);

    const jec = await searchUnits(db, { query: "joint economic" });
    expect(jec.map((unit) => unit.unitId)).toEqual(["joint--joint-economic-committee"]);
    expect(jec[0].cleanups).toEqual([
      expect.objectContaining({
        kind: "deutscher_text",
        after: expect.stringMatching(/^It shall be the function/),
      }),
    ]);

    const byText = await searchUnits(db, { query: "Bonded debt" });
    expect(byText.map((unit) => unit.unitId)).toContain("senate--finance");

    const healthCare = (await searchUnits(db, { query: "Subcommittee on Health Care" })).find(
      (unit) => unit.unitId === "senate--finance--health-care",
    );
    expect(healthCare).toMatchObject({
      kind: "subcommittee",
      chamber: "senate",
      committeeName: "Committee on Finance",
      inputBasis: "name_only",
      jurisdictionText: null,
      parentCommitteeName: "Committee on Finance",
      cleanups: [],
    });
  });

  test("liefert Units, Industries und Quelle eines geladenen Snapshots so wie in der Datei", async () => {
    const db = await createTestDatabase();
    const { snapshotId } = await loadSnapshot(db, snapshot);

    const content = await getSnapshotContent(db, snapshotId);

    const byUnitId = (a: { unitId: string }, b: { unitId: string }) => (a.unitId < b.unitId ? -1 : 1);
    const byIndustryId = (a: { industryId: string }, b: { industryId: string }) =>
      a.industryId < b.industryId ? -1 : 1;
    expect(content?.contentHash).toBe(snapshot.contentHash);
    expect(content?.source).toEqual(snapshot.source);
    expect(content?.units.toSorted(byUnitId)).toEqual(snapshot.units.toSorted(byUnitId));
    expect(content?.industries.toSorted(byIndustryId)).toEqual(snapshot.industries.toSorted(byIndustryId));
    expect(await getSnapshotContent(db, snapshotId + 1)).toBeNull();
  });

  test("findet Industries über Name, Sektor und Beschreibung", async () => {
    const db = await loadedDatabase();

    expect(await searchIndustries(db, {})).toHaveLength(145);
    const airlines = await searchIndustries(db, { query: "passenger airline" });
    expect(airlines.map((industry) => industry.industryId)).toEqual(["airlines"]);
    const utilities = await searchIndustries(db, { query: "Utilities" });
    expect(utilities.map((industry) => industry.industryId)).toEqual(
      expect.arrayContaining(["utilities-regulated-electric", "utilities-renewable"]),
    );
  });
});
