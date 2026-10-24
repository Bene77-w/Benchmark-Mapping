import { beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "@/server/db/test-database";
import { type ModelsDevSnapshot, readModelsDevSnapshot } from "./models-dev";
import { getPriceTable, loadModelsDevSnapshot } from "./store";

/** Seam 1 – Preistabelle in der Datenbank: Snapshot laden, Preise pflegen, Einträge aus Läufen. */

let modelsDev: ModelsDevSnapshot;
beforeAll(async () => {
  modelsDev = await readModelsDevSnapshot();
});

describe("models.dev-Snapshot", () => {
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
