import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/database";
import { createTestDatabase } from "@/server/db/test-database";
import { createFakeAdapter } from "@/server/harness/fake";
import { buildBenchmarkPrompt } from "@/server/prompt/benchmark-prompt";
import { processNextRun } from "@/server/runs/runner";
import { createRun, getRun, listEvaluationRuns } from "@/server/runs/store";
import type { Snapshot } from "@/server/snapshot/model";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { GoldValidationError } from "./model";
import {
  addGoldUnit,
  checkGoldDraft,
  finalizeGoldDraft,
  getGoldDraft,
  getGoldProposalRuns,
  getGoldUnitReview,
  getGoldVersion,
  getLatestGoldVersion,
  removeGoldUnit,
  saveGoldUnitDecision,
  setGoldUnitCategory,
  startProposalRun,
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

describe("Vorschlagsläufe und Review", { timeout: 30_000 }, () => {
  const proposal = (model: string) => ({
    configuration: { harness: "fake", model, effort: "max" } as const,
    parallelism: 2,
    timeoutMs: 60_000,
  });

  test("ein Vorschlagslauf nutzt Gold-Brief und Web über die Units des Entwurfs", async () => {
    const db = await databaseWithSnapshot();
    await expect(startProposalRun(db, proposal("vorschlag-a"))).rejects.toThrow(/Entwurf/);
    await addGoldUnit(db, { unitId: AVIATION, category: "a" });
    await addGoldUnit(db, { unitId: ETHICS, category: "c" });

    const { runId } = await startProposalRun(db, proposal("vorschlag-a"));
    const goldPrompt = await buildBenchmarkPrompt(snapshot, { runKind: "proposal", mode: "web" });
    expect(await getRun(db, runId)).toMatchObject({
      kind: "proposal",
      configuration: { harness: "fake", model: "vorschlag-a", effort: "max", mode: "web" },
      promptHash: goldPrompt.promptHash,
      progress: { total: 2, pending: 2 },
    });
    expect((await getGoldProposalRuns(db)).map((run) => run.id)).toEqual([runId]);
  });

  test("die Review zeigt beliebig viele Vorschläge je Unit nebeneinander mit Unterschieden", async () => {
    const db = await databaseWithSnapshot();
    await addGoldUnit(db, { unitId: AVIATION, category: "a" });
    await addGoldUnit(db, { unitId: ETHICS, category: "c" });
    const adapters = { fake: createFakeAdapter() };
    const runA = (await startProposalRun(db, proposal("vorschlag-a"))).runId;
    const runB = (await startProposalRun(db, proposal("vorschlag-b"))).runId;
    const runC = (await startProposalRun(db, proposal("vorschlag-a"))).runId;
    while ((await processNextRun(db, { adapters })) !== null) {}

    const review = await getGoldUnitReview(db, AVIATION);
    expect(review?.unit.unitName).toBe("Subcommittee on Aviation");
    expect(review?.unit.jurisdictionText).toBeTruthy();
    expect(review?.gold).toMatchObject({ unitId: AVIATION, category: "a", industries: [] });
    expect(review?.proposals.map((p) => [p.runId, p.answer?.decision])).toEqual([
      [runA, "mapped"],
      [runB, "mapped"],
      [runC, "mapped"],
    ]);
    expect(review?.proposals[1]).toMatchObject({
      configuration: { model: "vorschlag-b" },
      answer: {
        label_uncertain: true,
        uncertainty_note: "Ob Flugzeughersteller direkt betroffen sind, ist strittig.",
        sources: [{ url: "https://www.faa.gov/aircraft/air_cert" }],
      },
    });
    expect(review?.decisionsDiffer).toBe(false);
    expect(
      review?.industries.map(({ industryId, proposedBy, unanimous }) => ({
        industryId,
        proposedBy,
        unanimous,
      })),
    ).toEqual([
      { industryId: "aerospace-defense", proposedBy: [runB], unanimous: false },
      { industryId: "airlines", proposedBy: [runA, runB, runC], unanimous: true },
      { industryId: "airports-air-services", proposedBy: [runA, runC], unanimous: false },
    ]);
    expect(review?.industries[1]).toMatchObject({ industryName: "Airlines", sectorName: "Industrials" });

    // Zusätzlich hinzugefügte Gold-Industries erscheinen ohne Vorschlag; abweichende Entscheidungen werden markiert.
    await saveGoldUnitDecision(db, AVIATION, {
      category: "a",
      noMapping: false,
      note: null,
      industries: [{ industryId: "travel-services", class: "vertretbar", webOnly: true }],
    });
    const edited = await getGoldUnitReview(db, AVIATION);
    expect(edited?.industries.find((row) => row.industryId === "travel-services")).toMatchObject({
      proposedBy: [],
      gold: { class: "vertretbar", webOnly: true },
    });
    const ethics = await getGoldUnitReview(db, ETHICS);
    expect(ethics?.decisionsDiffer).toBe(true);
    expect(ethics?.proposals.map((p) => p.answer?.decision)).toEqual(["no_mapping", "mapped", "no_mapping"]);
  });
});

describe("Auswertung", { timeout: 30_000 }, () => {
  test("Vorschlagsläufe erscheinen nie in Rangliste oder Diagrammen, abgeschlossene Benchmark-Läufe schon", async () => {
    const db = await databaseWithSnapshot();
    await addGoldUnit(db, { unitId: AVIATION, category: "a" });
    await addGoldUnit(db, { unitId: ETHICS, category: "c" });
    const proposalRun = await startProposalRun(db, {
      configuration: { harness: "fake", model: "vorschlag-a", effort: "max" },
    });
    const benchmarkRun = await createRun(db, {
      configuration: { harness: "fake", model: "vorschlag-a", effort: "max", mode: "web" },
      unitIds: [AVIATION, ETHICS],
    });
    expect(await listEvaluationRuns(db)).toEqual([]);

    const adapters = { fake: createFakeAdapter() };
    while ((await processNextRun(db, { adapters })) !== null) {}
    expect((await getRun(db, proposalRun.runId))?.status).toBe("completed");
    expect((await listEvaluationRuns(db)).map((run) => run.id)).toEqual([benchmarkRun.runId]);
  });
});
