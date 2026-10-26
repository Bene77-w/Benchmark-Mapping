import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/database";
import { createTestDatabase } from "@/server/db/test-database";
import type { GoldUnit as GoldDraftUnit } from "@/server/gold/model";
import {
  addGoldUnit,
  finalizeGoldDraft,
  getGoldVersion,
  removeGoldUnit,
  saveGoldUnitDecision,
  startGoldDraftFromVersion,
  startProposalRun,
} from "@/server/gold/store";
import { readTestGold } from "@/server/gold/test-gold";
import type { HarnessAdapter } from "@/server/harness/adapter";
import { createFakeAdapter } from "@/server/harness/fake";
import { processNextRun } from "@/server/runs/runner";
import { createRun, getRun, supplementRun } from "@/server/runs/store";
import type { Snapshot } from "@/server/snapshot/model";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { getReevaluationStatus, listCurrentEvaluations } from "./current";
import type { GoldUnit } from "./model";
import { listEvaluations } from "./store";

/**
 * Seam 1 – Gold-Versionen und Neubewertung über die Schnittstelle des Kerns: Läufe mit Fake-Harness
 * ausführen, Gold-Versionen über die Gold-Review abschließen und die Bewertungen gegen die aktuelle
 * Gold-Version lesen. Ein zählender Adapter zeigt, dass die Neubewertung kein Modell aufruft.
 */

const AVIATION = "house--transportation-and-infrastructure--aviation";
const LIVESTOCK = "house--agriculture--livestock-dairy-and-poultry";
const ETHICS = "house--ethics";
const VETERANS = "house--veterans-affairs--health";
const JEC = "joint--joint-economic-committee";
const fakeConfiguration = { harness: "fake", model: "standard", effort: "high", mode: "text_only" } as const;

let snapshot: Snapshot;
let testGoldUnits: GoldUnit[];
beforeAll(async () => {
  snapshot = await readSnapshotFile(SNAPSHOT_PATH);
  testGoldUnits = (await readTestGold()).units;
});

async function databaseWithSnapshot(): Promise<Database> {
  const db = await createTestDatabase();
  await loadSnapshot(db, snapshot);
  return db;
}

/** Fake-Adapter, der seine Aufrufe je Unit mitschreibt. */
function countingAdapter(): { adapter: HarnessAdapter; calls: string[] } {
  const inner = createFakeAdapter();
  const calls: string[] = [];
  return {
    calls,
    adapter: {
      ...inner,
      run: (task) => {
        calls.push(task.unitId);
        return inner.run(task);
      },
    },
  };
}

/** Übernimmt die Entscheidung des Test-Golds für eine Unit in den Entwurf. */
async function addTestGoldUnit(db: Database, unitId: string): Promise<void> {
  const unit = testGoldUnits.find((entry) => entry.unitId === unitId);
  if (!unit) throw new Error(`${unitId} fehlt im Test-Gold`);
  await addGoldUnit(db, { unitId, category: unit.category });
  await saveGoldUnitDecision(db, unitId, { ...unit, note: null });
}

/** Erste Gold-Version aus den Entscheidungen des Test-Golds für die angegebenen Units. */
async function freezeFirstGold(db: Database, unitIds: string[]): Promise<string> {
  for (const unitId of unitIds) await addTestGoldUnit(db, unitId);
  return (await finalizeGoldDraft(db)).label;
}

async function runToCompletion(db: Database, adapter: HarnessAdapter, unitIds: string[]): Promise<number> {
  const { runId } = await createRun(db, { configuration: fakeConfiguration, unitIds });
  expect(await processNextRun(db, { adapters: { fake: adapter } })).toBe(runId);
  expect((await getRun(db, runId))?.status).toBe("completed");
  return runId;
}

async function goldOf(db: Database, label: string) {
  const view = await getGoldVersion(db, label);
  if (!view?.label) throw new Error(`${label} fehlt`);
  return { version: view.label, units: view.units };
}

describe("Neubewertung bei neuer Gold-Version", { timeout: 60_000 }, () => {
  test("jede neue Gold-Version bewertet alle abgeschlossenen Benchmark-Läufe neu, ohne Adapteraufruf", async () => {
    const db = await databaseWithSnapshot();
    const { adapter, calls } = countingAdapter();
    const units = [AVIATION, LIVESTOCK, ETHICS, VETERANS];
    const first = await runToCompletion(db, adapter, units);
    const second = await runToCompletion(db, adapter, units);
    // Ein Vorschlagslauf (eigener Entwurf ohne Abschluss) wird nie bewertet.
    await addTestGoldUnit(db, AVIATION);
    const proposal = (
      await startProposalRun(db, { configuration: { harness: "fake", model: "vorschlag-a", effort: "max" } })
    ).runId;
    expect(await processNextRun(db, { adapters: { fake: adapter } })).toBe(proposal);
    for (const unitId of [LIVESTOCK, ETHICS, VETERANS]) await addTestGoldUnit(db, unitId);
    const callsBefore = calls.length;

    expect(await finalizeGoldDraft(db)).toMatchObject({ label: "gold-v1" });
    const v1 = await goldOf(db, "gold-v1");
    expect(await getReevaluationStatus(db, v1)).toEqual({
      goldVersion: "gold-v1",
      runs: 2,
      evaluated: 2,
      complete: 2,
      incomplete: 0,
    });
    // Fake-Antworten: Aviation 1, Livestock 2/3, Ethics 1, Veterans invalid_json 0.
    const current = await listCurrentEvaluations(db, v1);
    expect(current.runs.map((entry) => entry.run.id)).toEqual([second, first]);
    expect(current.runs[0].evaluation.score).toBeCloseTo((1 + 2 / 3 + 1 + 0) / 4, 10);
    expect(current.incomplete).toEqual([]);
    expect(await listEvaluations(db, proposal)).toEqual([]);

    // gold-v2: aerospace-defense wird für Aviation positiv; die Antwort nennt sie nicht (Recall 2/3, F1 0.8).
    await startGoldDraftFromVersion(db, "gold-v1");
    const aviation = v1.units.find((unit) => unit.unitId === AVIATION) as GoldDraftUnit;
    await saveGoldUnitDecision(db, AVIATION, {
      ...aviation,
      industries: aviation.industries.map((industry) =>
        industry.industryId === "aerospace-defense" ? { ...industry, class: "positiv" } : industry,
      ),
    });
    expect(await finalizeGoldDraft(db)).toMatchObject({ label: "gold-v2" });
    const v2 = await goldOf(db, "gold-v2");

    expect(await getReevaluationStatus(db, v2)).toMatchObject({ runs: 2, evaluated: 2, complete: 2 });
    for (const runId of [first, second]) {
      const stored = await listEvaluations(db, runId);
      expect(stored.map((entry) => entry.goldVersion)).toEqual(["gold-v1", "gold-v2"]);
      expect(stored[0].score).toBeCloseTo((1 + 2 / 3 + 1 + 0) / 4, 10);
      expect(stored[1].score).toBeCloseTo((0.8 + 2 / 3 + 1 + 0) / 4, 10);
    }
    expect(calls.length).toBe(callsBefore);
  });
});

describe("Hinzugefügte Units", { timeout: 60_000 }, () => {
  test("ein Lauf ohne Ergebnis für eine neue Unit ist unvollständig und ausgeblendet; die Ergänzung ruft nur sie auf", async () => {
    const db = await databaseWithSnapshot();
    const { adapter, calls } = countingAdapter();
    await freezeFirstGold(db, [AVIATION, LIVESTOCK, ETHICS, VETERANS]);
    const runId = await runToCompletion(db, adapter, [AVIATION, LIVESTOCK, ETHICS, VETERANS]);
    const before = await getRun(db, runId);

    await startGoldDraftFromVersion(db, "gold-v1");
    await addTestGoldUnit(db, JEC);
    expect((await finalizeGoldDraft(db)).reevaluation).toMatchObject({ runs: 1, complete: 0, incomplete: 1 });
    const v2 = await goldOf(db, "gold-v2");
    const hidden = await listCurrentEvaluations(db, v2);
    expect(hidden.runs).toEqual([]);
    expect(hidden.incomplete.map(({ run, missingUnitIds }) => [run.id, missingUnitIds])).toEqual([
      [runId, [JEC]],
    ]);

    calls.length = 0;
    expect(
      await supplementRun(
        db,
        runId,
        v2.units.map((unit) => unit.unitId),
      ),
    ).toEqual({ added: [JEC] });
    expect((await getRun(db, runId))?.status).toBe("queued");
    expect(await processNextRun(db, { adapters: { fake: adapter } })).toBe(runId);
    expect(calls).toEqual([JEC]);

    const supplemented = await getRun(db, runId);
    expect(supplemented?.status).toBe("completed");
    expect(supplemented?.progress).toEqual({ total: 5, pending: 0, running: 0, done: 4, failed: 1 });
    // Die bisherigen Ergebnisse bleiben unverändert; die ergänzte Unit hat ihren eigenen Zeitstempel.
    for (const unit of before?.units ?? []) {
      expect(supplemented?.units.find((entry) => entry.unitId === unit.unitId)).toEqual(unit);
    }
    const jec = supplemented?.units.find((unit) => unit.unitId === JEC);
    expect(jec?.finishedAt?.getTime()).toBeGreaterThan(before?.finishedAt?.getTime() ?? Number.NaN);

    // Fake-Antworten: Aviation 1, Livestock 2/3, Ethics 1, Veterans 0, JEC (no_mapping-Gold, Antwort mapped) 0.
    const visible = await listCurrentEvaluations(db, v2);
    expect(visible.incomplete).toEqual([]);
    expect(visible.runs.map((entry) => entry.run.id)).toEqual([runId]);
    expect(visible.runs[0].evaluation.score).toBeCloseTo((1 + 2 / 3 + 1 + 0 + 0) / 5, 10);
    expect(await getReevaluationStatus(db, v2)).toMatchObject({ evaluated: 1, complete: 1, incomplete: 0 });
  });
});

describe("Entfernte Units", { timeout: 60_000 }, () => {
  test("Antworten zu entfernten Units bleiben erhalten, zählen nicht und bei Wiederaufnahme wieder", async () => {
    const db = await databaseWithSnapshot();
    const { adapter, calls } = countingAdapter();
    await freezeFirstGold(db, [AVIATION, LIVESTOCK, ETHICS, VETERANS, JEC]);
    const runId = await runToCompletion(db, adapter, [AVIATION, LIVESTOCK, ETHICS, VETERANS, JEC]);
    const v1Score = (1 + 2 / 3 + 1 + 0 + 0) / 5;
    expect(
      (await listCurrentEvaluations(db, await goldOf(db, "gold-v1"))).runs[0].evaluation.score,
    ).toBeCloseTo(v1Score, 10);
    const callsBefore = calls.length;

    // gold-v2 ohne Veterans (invalid_json, Score 0).
    await startGoldDraftFromVersion(db, "gold-v1");
    await removeGoldUnit(db, VETERANS);
    await finalizeGoldDraft(db);
    const v2 = await listCurrentEvaluations(db, await goldOf(db, "gold-v2"));
    expect(v2.runs.map((entry) => entry.run.id)).toEqual([runId]);
    expect(v2.runs[0].evaluation.score).toBeCloseTo((1 + 2 / 3 + 1 + 0) / 4, 10);
    expect(v2.runs[0].evaluation.units.map((unit) => unit.unitId)).not.toContain(VETERANS);
    expect(v2.runs[0].evaluation.formatErrors).toBe(0);
    const kept = (await getRun(db, runId))?.units.find((unit) => unit.unitId === VETERANS);
    expect(kept).toMatchObject({ status: "failed", error: { kind: "invalid_json" } });
    expect(kept?.rawResponse).toBeTruthy();

    // gold-v3 nimmt Veterans wieder auf: das gespeicherte Ergebnis zählt wieder, ohne neuen Aufruf.
    await startGoldDraftFromVersion(db, "gold-v2");
    await addTestGoldUnit(db, VETERANS);
    await finalizeGoldDraft(db);
    const v3 = await listCurrentEvaluations(db, await goldOf(db, "gold-v3"));
    expect(v3.incomplete).toEqual([]);
    expect(v3.runs[0].evaluation.score).toBeCloseTo(v1Score, 10);
    expect(v3.runs[0].evaluation.formatErrors).toBe(1);
    expect(calls.length).toBe(callsBefore);
  });
});
