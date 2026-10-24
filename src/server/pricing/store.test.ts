import { beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "@/server/db/test-database";
import { createRun } from "@/server/runs/store";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";
import { type ModelsDevSnapshot, readModelsDevSnapshot } from "./models-dev";
import {
  getPriceTable,
  listModels,
  listWebSearchPrices,
  loadModelsDevSnapshot,
  saveModelPrice,
  saveWebSearchPrice,
} from "./store";

/** Seam 1 – Preistabelle in der Datenbank: Snapshot laden, Preise pflegen, Einträge aus Läufen. */

let modelsDev: ModelsDevSnapshot;
beforeAll(async () => {
  modelsDev = await readModelsDevSnapshot();
});

describe("models.dev-Snapshot", { timeout: 30_000 }, () => {
  test("ist datiert im Repo und befüllt die Preistabelle, gültig ab Abrufdatum", async () => {
    expect(modelsDev.retrievedAt).toBe("2026-10-24");
    const db = await createTestDatabase();

    await loadModelsDevSnapshot(db, modelsDev);
    const table = await getPriceTable(db);

    // Werte laut models.dev vom 2026-10-24 (Grundtarif, USD pro Million Tokens).
    const haiku = { validFrom: "2026-10-24", input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 };
    expect(table.models["claude-haiku-5-5"]).toEqual([haiku]);
    expect(table.models["anthropic/claude-haiku-5-5"]).toEqual([haiku]);
    expect(table.models["gpt-5.6-luna"]).toEqual([
      { validFrom: "2026-10-24", input: 0.2, cacheRead: 0.02, cacheWrite: 0.25, output: 1.2 },
    ]);
    expect(table.models["deepseek/deepseek-flash"]).toEqual([
      { validFrom: "2026-10-24", input: 0.15, cacheRead: 0.003, cacheWrite: null, output: 0.6 },
    ]);
    // Ohne Anbieter-Präfix nur Anthropic und OpenAI; Modelle ohne Preis fehlen.
    expect(table.models["deepseek-flash"]).toBeUndefined();
    expect(table.models["gpt-image-1"]).toBeUndefined();
  });

  test("erneutes Laden ist idempotent", async () => {
    const db = await createTestDatabase();
    await loadModelsDevSnapshot(db, modelsDev);
    const first = await getPriceTable(db);
    await loadModelsDevSnapshot(db, modelsDev);
    expect(await getPriceTable(db)).toEqual(first);
  });
});

describe("Preise pflegen", { timeout: 30_000 }, () => {
  const price = { input: 1, cacheRead: 0.1, cacheWrite: null, output: 4 };

  test("legt Modell und Preis an; gleiches Gültig-ab-Datum ändert den Preis, neues Datum ergänzt die Historie", async () => {
    const db = await createTestDatabase();

    await saveModelPrice(db, { modelId: "gpt-reserve", validFrom: "2026-10-01", ...price });
    await saveModelPrice(db, { modelId: "gpt-reserve", validFrom: "2026-10-01", ...price, output: 5 });
    await saveModelPrice(db, { modelId: "gpt-reserve", validFrom: "2026-11-01", ...price, input: 2 });

    expect((await getPriceTable(db)).models["gpt-reserve"]).toEqual([
      { validFrom: "2026-10-01", ...price, output: 5 },
      { validFrom: "2026-11-01", ...price, input: 2 },
    ]);
    const [model] = await listModels(db);
    expect(model).toMatchObject({ id: "gpt-reserve", source: "manuell" });
    // Neuester Preis zuerst.
    expect(model.prices.map((entry) => entry.validFrom)).toEqual(["2026-11-01", "2026-10-01"]);
    expect(model.prices[1]).toMatchObject({ output: 5, source: "manuell" });
  });

  test("lehnt ungültige Preise ab", async () => {
    const db = await createTestDatabase();
    await expect(saveModelPrice(db, { modelId: " ", validFrom: "2026-10-01", ...price })).rejects.toThrow();
    await expect(saveModelPrice(db, { modelId: "m", validFrom: "1.10.2026", ...price })).rejects.toThrow();
    await expect(
      saveModelPrice(db, { modelId: "m", validFrom: "2026-10-01", ...price, input: -1 }),
    ).rejects.toThrow();
  });

  test("Websuchpreis je Harness: anlegen und am gleichen Gültig-ab-Datum ändern", async () => {
    const db = await createTestDatabase();
    await saveWebSearchPrice(db, { harness: "claude_code", validFrom: "2026-10-23", perSearch: 0.02 });
    await saveWebSearchPrice(db, { harness: "claude_code", validFrom: "2026-10-23", perSearch: 0.01 });
    await saveWebSearchPrice(db, { harness: "codex", validFrom: "2026-10-23", perSearch: 0.03 });

    expect((await getPriceTable(db)).webSearch).toEqual({
      claude_code: [{ validFrom: "2026-10-23", perSearch: 0.01 }],
      codex: [{ validFrom: "2026-10-23", perSearch: 0.03 }],
    });
    expect(await listWebSearchPrices(db)).toMatchObject([
      { harness: "claude_code", validFrom: "2026-10-23", perSearch: 0.01 },
      { harness: "codex", validFrom: "2026-10-23", perSearch: 0.03 },
    ]);
  });
});

describe("Modelle aus Läufen", { timeout: 30_000 }, () => {
  test("ein Lauf mit unbekanntem Modell legt einen Eintrag ohne Preis an; bekannte Modelle bleiben unverändert", async () => {
    const db = await createTestDatabase();
    await loadSnapshot(db, await readSnapshotFile(SNAPSHOT_PATH));
    await saveModelPrice(db, {
      modelId: "bekannt",
      validFrom: "2026-10-01",
      input: 1,
      cacheRead: null,
      cacheWrite: null,
      output: 2,
    });
    const run = (model: string) =>
      createRun(db, {
        configuration: { harness: "fake", model, effort: "high", mode: "text_only" },
        unitIds: ["house--ethics"],
      });

    await run("gpt-reserve");
    await run("gpt-reserve");
    await run("bekannt");

    const listed = await listModels(db);
    expect(listed.map(({ id, source, prices }) => ({ id, source, prices: prices.length }))).toEqual([
      { id: "bekannt", source: "manuell", prices: 1 },
      { id: "gpt-reserve", source: "Lauf", prices: 0 },
    ]);
    expect((await getPriceTable(db)).models["gpt-reserve"]).toBeUndefined();
  });
});
