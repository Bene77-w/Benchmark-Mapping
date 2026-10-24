import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { Database } from "@/server/db/database";
import { createTestDatabase } from "@/server/db/test-database";
import {
  type HarnessAdapter,
  type HarnessResult,
  type HarnessTask,
  parseAnswerText,
} from "@/server/harness/adapter";
import { createFakeAdapter } from "@/server/harness/fake";
import { buildBenchmarkPrompt, PROMPT_ROOT, PROMPT_VERSION } from "@/server/prompt/benchmark-prompt";
import type { Snapshot } from "@/server/snapshot/model";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { processNextRun } from "./runner";
import { createRun, createRunFromConfiguration, getRun, listConfigurations, listRuns } from "./store";

/**
 * Seam 1 – Benchmark-Kern: Lauf über die Schnittstelle des Kerns anlegen und ausführen (wie der Worker),
 * mit Fake-Harness und Test-Datenbank.
 */

const STANDARD_UNITS = [
  "house--transportation-and-infrastructure--aviation",
  "house--agriculture--livestock-dairy-and-poultry",
  "house--ethics",
  "house--veterans-affairs--health",
  "joint--joint-economic-committee",
];
const fakeConfiguration = { harness: "fake", model: "standard", effort: "high", mode: "text_only" } as const;

let snapshot: Snapshot;
beforeAll(async () => {
  snapshot = await readSnapshotFile(SNAPSHOT_PATH);
});

async function databaseWithSnapshot(): Promise<Database> {
  const db = await createTestDatabase();
  await loadSnapshot(db, snapshot);
  return db;
}

// Test-Datenbank mit vollem Snapshot und Fake-Wartezeiten: länger als der Standard, wenn alle Dateien parallel laufen.
describe("Lauf mit Fake-Harness", { timeout: 30_000 }, () => {
  test("legt den Lauf mit Hashes und Einstellungen an, führt alle Units aus und schließt ihn ab", async () => {
    const db = await databaseWithSnapshot();
    const prompt = await buildBenchmarkPrompt(snapshot, { runKind: "benchmark", mode: "text_only" });

    const { runId } = await createRun(db, {
      configuration: fakeConfiguration,
      parallelism: 2,
      timeoutMs: 60_000,
      unitIds: STANDARD_UNITS,
    });

    const queued = await getRun(db, runId);
    expect(queued).toMatchObject({
      kind: "benchmark",
      status: "queued",
      configuration: fakeConfiguration,
      snapshotHash: snapshot.contentHash,
      promptVersion: "prompt-v1",
      promptHash: prompt.promptHash,
      outputSchemaVersion: "unit-answer-v1",
      outputSchemaHash: prompt.outputSchemaHash,
      parallelism: 2,
      timeoutMs: 60_000,
      progress: { total: 5, pending: 5, running: 0, done: 0, failed: 0 },
    });

    expect(await processNextRun(db, { adapters: { fake: createFakeAdapter() } })).toBe(runId);

    const run = await getRun(db, runId);
    expect(run?.status).toBe("completed");
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(run?.progress).toEqual({ total: 5, pending: 0, running: 0, done: 4, failed: 1 });

    const aviation = run?.units.find(
      (unit) => unit.unitId === "house--transportation-and-infrastructure--aviation",
    );
    expect(aviation).toMatchObject({
      status: "done",
      attempts: 1,
      unitPromptHash: prompt.forUnit("house--transportation-and-infrastructure--aviation").unitPromptHash,
      answer: {
        decision: "mapped",
        assignments: [{ industry_id: "airlines" }, { industry_id: "airports-air-services" }],
      },
      error: null,
      tokens: {
        inputTokens: 5200,
        cacheReadTokens: 31000,
        cacheWriteTokens: 0,
        outputTokens: 640,
        reasoningTokens: 210,
      },
      webSearches: 0,
      effort: { reported: "high", confirmed: true },
      nativeCostUsd: 0.0123,
      exitCode: 0,
      cliVersion: "fake-harness-1",
      modelReported: "standard",
    });
    expect(aviation?.rawResponse).toContain('"industry_id":"airlines"');
    expect(aviation?.log).toContain("house--transportation-and-infrastructure--aviation");
    expect(aviation?.durationMs).toBeGreaterThanOrEqual(400);
    expect(aviation?.finishedAt).toBeInstanceOf(Date);

    const veterans = run?.units.find((unit) => unit.unitId === "house--veterans-affairs--health");
    expect(veterans).toMatchObject({
      status: "failed",
      // Ungültiges JSON löst einen Wiederholversuch aus; der Fake antwortet beide Male gleich.
      attempts: 2,
      answer: null,
      error: { kind: "invalid_json" },
      rawResponse: expect.stringContaining("Medical Care Facilities"),
      tokens: { outputTokens: 2 * 95 },
    });

    expect(await processNextRun(db, { adapters: { fake: createFakeAdapter() } })).toBeNull();
  });

  test.each([
    1, 3, 5,
  ])("ruft bei Parallelität %i höchstens so viele Units gleichzeitig auf", async (parallelism) => {
    const db = await databaseWithSnapshot();
    const unitIds = snapshot.units.slice(0, 8).map((unit) => unit.unitId);
    const adapter = gatedAdapter();
    const { runId } = await createRun(db, { configuration: fakeConfiguration, parallelism, unitIds });

    const processing = processNextRun(db, { adapters: { fake: adapter } });
    await adapter.waitForCalls(parallelism);
    expect((await getRun(db, runId))?.progress).toEqual({
      total: 8,
      pending: 8 - parallelism,
      running: parallelism,
      done: 0,
      failed: 0,
    });

    // Jede fertige Unit ist sofort gespeichert, während die übrigen noch laufen.
    adapter.release(1);
    await adapter.waitForCalls(parallelism + 1);
    expect((await getRun(db, runId))?.progress).toMatchObject({ done: 1, running: parallelism });

    adapter.releaseAll();
    await processing;
    expect(adapter.maxConcurrent).toBe(parallelism);
    expect((await getRun(db, runId))?.status).toBe("completed");
  });

  test("eine schemakonforme Antwort für eine andere Unit gilt als Schemaverstoß und wird nicht als Antwort gespeichert", async () => {
    const db = await databaseWithSnapshot();
    const root = await mkdtemp(path.join(tmpdir(), "fake-harness-"));
    await mkdir(path.join(root, "falsche-unit"));
    const otherUnitAnswer = {
      unit_id: "house--agriculture--livestock-dairy-and-poultry",
      decision: "no_mapping",
      no_mapping_reason: "Keine Industry.",
      broad_scope_exception: false,
      broad_scope_reason: null,
      assignments: [],
      sources: [],
      label_uncertain: false,
      uncertainty_note: null,
    };
    await writeFile(
      path.join(root, "falsche-unit", "house--ethics.json"),
      JSON.stringify({ response: otherUnitAnswer }),
    );
    const { runId } = await createRun(db, {
      configuration: { ...fakeConfiguration, model: "falsche-unit" },
      unitIds: ["house--ethics"],
    });

    await processNextRun(db, { adapters: { fake: createFakeAdapter({ root }) } });

    const run = await getRun(db, runId);
    expect(run?.progress).toMatchObject({ done: 0, failed: 1 });
    expect(run?.units[0]).toMatchObject({
      unitId: "house--ethics",
      status: "failed",
      answer: null,
      error: {
        kind: "schema_violation",
        message: expect.stringContaining("house--agriculture--livestock-dairy-and-poultry"),
      },
      rawResponse: expect.stringContaining("house--agriculture--livestock-dairy-and-poultry"),
    });
  });

  test("lehnt Parallelität außerhalb 1–5, leere Unit-Listen und unbekannte Units ab", async () => {
    const db = await databaseWithSnapshot();
    const request = { configuration: fakeConfiguration, unitIds: ["house--ethics"] };

    await expect(createRun(db, { ...request, parallelism: 0 })).rejects.toThrow();
    await expect(createRun(db, { ...request, parallelism: 6 })).rejects.toThrow();
    await expect(createRun(db, { ...request, unitIds: [] })).rejects.toThrow();
    await expect(createRun(db, { ...request, unitIds: ["gibt-es-nicht"] })).rejects.toThrow(/gibt-es-nicht/);
    expect(await listRuns(db)).toEqual([]);

    const { runId } = await createRun(db, request);
    expect(await getRun(db, runId)).toMatchObject({ parallelism: 3, timeoutMs: 30 * 60 * 1000 });
  });

  test("startet eine gespeicherte Konfiguration erneut mit Parallelität und Timeout ihres letzten Laufs", async () => {
    const db = await databaseWithSnapshot();
    await createRun(db, { configuration: fakeConfiguration, unitIds: ["house--ethics"] });
    const latest = await createRun(db, {
      configuration: fakeConfiguration,
      parallelism: 4,
      timeoutMs: 90_000,
      unitIds: ["house--ethics"],
    });

    const configurations = await listConfigurations(db);
    expect(configurations).toHaveLength(1);
    const [configuration] = configurations;
    expect(configuration).toMatchObject({ ...fakeConfiguration, runCount: 2, latestRunId: latest.runId });

    const { runId } = await createRunFromConfiguration(db, configuration.id, STANDARD_UNITS);
    const restarted = await getRun(db, runId);
    expect(restarted).toMatchObject({
      status: "queued",
      configuration: { id: configuration.id, ...fakeConfiguration },
      parallelism: 4,
      timeoutMs: 90_000,
      progress: { total: 5, pending: 5 },
    });
    expect((await listRuns(db)).map((run) => run.id)[0]).toBe(runId);
  });

  test("ein Lauf ohne Adapter für seinen Harness wird als nicht ausführbar markiert, ohne Units aufzurufen", async () => {
    const db = await databaseWithSnapshot();
    const { runId } = await createRun(db, {
      configuration: { ...fakeConfiguration, harness: "codex" },
      unitIds: ["house--ethics"],
    });

    expect(await processNextRun(db, { adapters: { fake: createFakeAdapter() } })).toBe(runId);

    const run = await getRun(db, runId);
    expect(run).toMatchObject({ status: "failed", error: expect.stringContaining("codex") });
    expect(run?.progress).toMatchObject({ pending: 1 });
  });

  test.each([
    ["Vertrag", "contract.md", (text: string) => `${text}\nZusatzregel.\n`],
    [
      "Vorlage des User-Prompts",
      "user-prompt.json",
      (text: string) => text.replace('"Kammer: ', '"Kammer -> '),
    ],
  ])("ein Lauf, dessen Benchmark-Prompt (%s) sich seit dem Anlegen geändert hat, wird nicht ausgeführt", async (_name, file, change) => {
    const db = await databaseWithSnapshot();
    const changedRoot = await mkdtemp(path.join(tmpdir(), "prompts-"));
    await cp(path.join(PROMPT_ROOT, PROMPT_VERSION), path.join(changedRoot, PROMPT_VERSION), {
      recursive: true,
    });
    const changedFile = path.join(changedRoot, PROMPT_VERSION, file);
    await writeFile(changedFile, change(await readFile(changedFile, "utf8")));
    const { runId } = await createRun(db, { configuration: fakeConfiguration, unitIds: ["house--ethics"] });

    await processNextRun(db, { adapters: { fake: createFakeAdapter() }, promptRoot: changedRoot });

    expect(await getRun(db, runId)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Benchmark-Prompt"),
      progress: { pending: 1 },
    });
  });
});

describe("Wiederholversuch und Format-Fehler", { timeout: 30_000 }, () => {
  test("Timeout, ungültiges JSON oder Schemaverstoß lösen genau einen Wiederholversuch aus; gelingt er, zählt seine Antwort", async () => {
    const db = await databaseWithSnapshot();
    const root = await fakeScenario("wiederholung", {
      "house--ethics": { calls: [{ response: "kein JSON" }, { response: noMappingAnswer("house--ethics") }] },
      "joint--joint-economic-committee": {
        calls: [{ simulate: "timeout" }, { response: noMappingAnswer("joint--joint-economic-committee") }],
      },
      "house--veterans-affairs--health": {
        calls: [
          { response: { unit_id: "house--veterans-affairs--health" } },
          { response: noMappingAnswer("house--veterans-affairs--health") },
        ],
      },
    });
    const adapter = countingAdapter(createFakeAdapter({ root }));
    const { runId } = await createRun(db, {
      configuration: { ...fakeConfiguration, model: "wiederholung" },
      unitIds: ["house--ethics", "joint--joint-economic-committee", "house--veterans-affairs--health"],
    });

    await processNextRun(db, { adapters: { fake: adapter } });

    const run = await getRun(db, runId);
    expect(run?.status).toBe("completed");
    expect(run?.progress).toMatchObject({ done: 3, failed: 0 });
    for (const unit of run?.units ?? []) {
      expect(unit).toMatchObject({
        status: "done",
        attempts: 2,
        error: null,
        answer: { decision: "no_mapping" },
      });
    }
    expect(adapter.callsOf("house--ethics")).toBe(2);
  });

  test("scheitert auch der Wiederholversuch, ist die Unit ein Format-Fehler; Regelverstöße und Harness-Fehler werden nicht wiederholt", async () => {
    const db = await databaseWithSnapshot();
    const ruleViolation = {
      ...noMappingAnswer("house--veterans-affairs--health"),
      decision: "mapped",
      no_mapping_reason: null,
      assignments: [{ industry_id: "gibt-es-nicht", evidence_excerpt: "Health", rationale_short: "Kurz." }],
    };
    const root = await fakeScenario("fehlschlag", {
      "house--ethics": { calls: [{ response: { unit_id: "house--ethics" } }, { response: "kein JSON" }] },
      "joint--joint-economic-committee": { simulate: "timeout" },
      "house--veterans-affairs--health": { response: ruleViolation },
      "house--transportation-and-infrastructure--aviation": { simulate: "harness_error" },
    });
    const adapter = countingAdapter(createFakeAdapter({ root }));
    const { runId } = await createRun(db, {
      configuration: { ...fakeConfiguration, model: "fehlschlag" },
      unitIds: [
        "house--ethics",
        "joint--joint-economic-committee",
        "house--veterans-affairs--health",
        "house--transportation-and-infrastructure--aviation",
      ],
    });

    await processNextRun(db, { adapters: { fake: adapter } });

    const run = await getRun(db, runId);
    expect(run?.status).toBe("completed");
    const unit = (unitId: string) => run?.units.find((result) => result.unitId === unitId);
    expect(unit("house--ethics")).toMatchObject({
      status: "failed",
      attempts: 2,
      answer: null,
      error: { kind: "invalid_json" },
      rawResponse: "kein JSON",
    });
    expect(unit("joint--joint-economic-committee")).toMatchObject({
      status: "failed",
      attempts: 2,
      error: { kind: "timeout" },
    });
    expect(unit("house--veterans-affairs--health")).toMatchObject({
      status: "done",
      attempts: 1,
      answer: { assignments: [{ industry_id: "gibt-es-nicht" }] },
    });
    expect(unit("house--transportation-and-infrastructure--aviation")).toMatchObject({
      status: "failed",
      attempts: 1,
      error: { kind: "harness_error" },
    });
    expect(adapter.callsOf("house--ethics")).toBe(2);
    expect(adapter.callsOf("joint--joint-economic-committee")).toBe(2);
    expect(adapter.callsOf("house--veterans-affairs--health")).toBe(1);
    expect(adapter.callsOf("house--transportation-and-infrastructure--aviation")).toBe(1);
  });

  test("Tokens, Websuchen, Kosten und Dauer aller Versuche werden zusammengezählt, das Protokoll enthält beide", async () => {
    const db = await databaseWithSnapshot();
    const root = await fakeScenario("kosten", {
      "house--ethics": {
        calls: [
          {
            response: "kein JSON",
            tokens: { input: 100, cacheRead: 1000, cacheWrite: 10, output: 20, reasoning: 5 },
            webSearches: 1,
            nativeCostUsd: 0.01,
            delayMs: 50,
          },
          {
            response: noMappingAnswer("house--ethics"),
            tokens: { input: 200, cacheRead: 2000, cacheWrite: 0, output: 40 },
            webSearches: 2,
            nativeCostUsd: 0.02,
            delayMs: 50,
          },
        ],
      },
    });
    const { runId } = await createRun(db, {
      configuration: { ...fakeConfiguration, model: "kosten" },
      unitIds: ["house--ethics"],
    });

    await processNextRun(db, { adapters: { fake: createFakeAdapter({ root }) } });

    const [unit] = (await getRun(db, runId))?.units ?? [];
    expect(unit).toMatchObject({
      status: "done",
      attempts: 2,
      tokens: {
        inputTokens: 300,
        cacheReadTokens: 3000,
        cacheWriteTokens: 10,
        outputTokens: 60,
        reasoningTokens: 5,
      },
      webSearches: 3,
    });
    expect(unit.nativeCostUsd).toBeCloseTo(0.03);
    expect(unit.durationMs).toBeGreaterThanOrEqual(100);
    expect(unit.log).toMatch(/Versuch 1[\s\S]*kein JSON[\s\S]*Versuch 2/);
  });
});

/** Legt ein Fake-Szenario `name` mit je einer Datei pro Unit an und liefert die Wurzel. */
async function fakeScenario(name: string, files: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "fake-harness-"));
  await mkdir(path.join(root, name));
  for (const [unitId, file] of Object.entries(files)) {
    await writeFile(path.join(root, name, `${unitId}.json`), JSON.stringify(file));
  }
  return root;
}

function noMappingAnswer(unitId: string) {
  return {
    unit_id: unitId,
    decision: "no_mapping",
    no_mapping_reason: "Keine Industry.",
    broad_scope_exception: false,
    broad_scope_reason: null,
    assignments: [],
    sources: [],
    label_uncertain: false,
    uncertainty_note: null,
  };
}

/** Reicht Aufrufe an `adapter` durch und zählt sie je Unit. */
function countingAdapter(adapter: HarnessAdapter) {
  const calls: string[] = [];
  return {
    harness: adapter.harness,
    calls,
    callsOf: (unitId: string) => calls.filter((id) => id === unitId).length,
    run(task: HarnessTask) {
      calls.push(task.unitId);
      return adapter.run(task);
    },
  };
}

/** Adapter, dessen Aufrufe erst auf Freigabe mit einer gültigen no_mapping-Antwort enden. */
function gatedAdapter() {
  const waiting: (() => void)[] = [];
  let calls = 0;
  let active = 0;
  let releaseAll = false;
  const callWaiters: { count: number; resolve: () => void }[] = [];
  const adapter = {
    harness: "fake" as const,
    maxConcurrent: 0,
    async run(task: HarnessTask): Promise<HarnessResult> {
      calls += 1;
      active += 1;
      adapter.maxConcurrent = Math.max(adapter.maxConcurrent, active);
      for (const waiter of callWaiters.filter((entry) => calls >= entry.count)) waiter.resolve();
      if (!releaseAll) await new Promise<void>((resolve) => waiting.push(resolve));
      active -= 1;
      const answer = {
        unit_id: task.unitId,
        decision: "no_mapping",
        no_mapping_reason: "Keine Industry.",
        broad_scope_exception: false,
        broad_scope_reason: null,
        assignments: [],
        sources: [],
        label_uncertain: false,
        uncertainty_note: null,
      };
      const rawResponse = JSON.stringify(answer);
      return {
        outcome: parseAnswerText(rawResponse, task.unitId),
        rawResponse,
        log: "",
        tokens: null,
        webSearches: null,
        effort: { reported: null, confirmed: false },
        nativeCostUsd: null,
        durationMs: 1,
        exitCode: 0,
        cliVersion: null,
        modelReported: null,
      };
    },
    waitForCalls(count: number): Promise<void> {
      if (calls >= count) return Promise.resolve();
      return new Promise((resolve) => callWaiters.push({ count, resolve }));
    },
    release(count: number) {
      for (const resolve of waiting.splice(0, count)) resolve();
    },
    releaseAll() {
      releaseAll = true;
      adapter.release(waiting.length);
    },
  };
  return adapter;
}
