import { asc, desc, sql } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import { modelPrices, models, webSearchPrices } from "@/server/db/schema";
import type { ModelPrice, PriceTable } from "./cost";
import {
  MANUAL_SOURCE,
  type ModelPriceInput,
  type ModelView,
  modelPriceInputSchema,
  type WebSearchPriceInput,
  type WebSearchPriceView,
  webSearchPriceInputSchema,
} from "./model";
import { type ModelsDevSnapshot, pricesFromModelsDev } from "./models-dev";

/**
 * Preistabelle in der Datenbank: Modelle (auch ohne Preis), Preise je Modell und Websuchpreise je Harness,
 * jeweils mit Gültig-ab-Datum. Geschätzte Kosten werden beim Anzeigen berechnet, nie gespeichert; eine
 * Preisänderung wirkt deshalb sofort auf alle betroffenen Läufe.
 */

/**
 * Lädt die Preise eines models.dev-Auszugs. Idempotent; bestehende Einträge (auch von Hand geänderte
 * Preise mit demselben Gültig-ab-Datum) bleiben unverändert.
 */
export async function loadModelsDevSnapshot(
  db: Database,
  snapshot: ModelsDevSnapshot,
): Promise<{ prices: number }> {
  const source = `models.dev ${snapshot.retrievedAt}`;
  const entries = pricesFromModelsDev(snapshot);
  if (entries.length === 0) return { prices: 0 };
  return db.transaction(async (tx) => {
    await tx
      .insert(models)
      .values(entries.map(({ modelId }) => ({ id: modelId, source })))
      .onConflictDoNothing();
    const inserted = await tx
      .insert(modelPrices)
      .values(entries.map(({ modelId, price }) => ({ modelId, ...price, source })))
      .onConflictDoNothing()
      .returning({ id: modelPrices.id });
    return { prices: inserted.length };
  });
}

/** Die ganze Preistabelle für die Kostenfunktion (Preise je Schlüssel nach Gültig-ab-Datum aufsteigend). */
export async function getPriceTable(db: Database): Promise<PriceTable> {
  const priceRows = await db.select().from(modelPrices).orderBy(asc(modelPrices.validFrom));
  const searchRows = await db.select().from(webSearchPrices).orderBy(asc(webSearchPrices.validFrom));
  const modelGroups = Map.groupBy(priceRows, (row) => row.modelId);
  const searchGroups = Map.groupBy(searchRows, (row) => row.harness);
  return {
    models: Object.fromEntries(
      [...modelGroups].map(([modelId, rows]) => [
        modelId,
        rows.map(
          ({ validFrom, input, cacheRead, cacheWrite, output }): ModelPrice => ({
            validFrom,
            input,
            cacheRead,
            cacheWrite,
            output,
          }),
        ),
      ]),
    ),
    webSearch: Object.fromEntries(
      [...searchGroups].map(([harness, rows]) => [
        harness,
        rows.map(({ validFrom, perSearch }) => ({ validFrom, perSearch })),
      ]),
    ),
  };
}

/** Legt ein Modell ohne Preis an, falls es die ID noch nicht gibt. */
export async function ensureModel(db: Database, modelId: string, source: string): Promise<void> {
  await db.insert(models).values({ id: modelId, source }).onConflictDoNothing();
}

/**
 * Legt einen Preis an oder ändert ihn: gleiches Modell und Gültig-ab-Datum überschreibt, ein neues Datum
 * ergänzt die Historie. Ein unbekanntes Modell wird dabei angelegt.
 */
export async function saveModelPrice(db: Database, input: ModelPriceInput): Promise<void> {
  const { modelId, ...price } = modelPriceInputSchema.parse(input);
  await db.transaction(async (tx) => {
    await ensureModel(tx, modelId, MANUAL_SOURCE);
    await tx
      .insert(modelPrices)
      .values({ modelId, ...price, source: MANUAL_SOURCE })
      .onConflictDoUpdate({
        target: [modelPrices.modelId, modelPrices.validFrom],
        set: { ...price, source: MANUAL_SOURCE, updatedAt: sql`now()` },
      });
  });
}

/** Legt einen Websuchpreis an oder ändert ihn (gleicher Harness und Gültig-ab-Datum überschreibt). */
export async function saveWebSearchPrice(db: Database, input: WebSearchPriceInput): Promise<void> {
  const { harness, validFrom, perSearch } = webSearchPriceInputSchema.parse(input);
  await db
    .insert(webSearchPrices)
    .values({ harness, validFrom, perSearch, source: MANUAL_SOURCE })
    .onConflictDoUpdate({
      target: [webSearchPrices.harness, webSearchPrices.validFrom],
      set: { perSearch, source: MANUAL_SOURCE, updatedAt: sql`now()` },
    });
}

/** Alle Modelle mit ihren Preisen (neuester zuerst), sortiert nach Modell-ID. */
export async function listModels(db: Database): Promise<ModelView[]> {
  const rows = await db.select().from(models).orderBy(asc(models.id));
  const prices = Map.groupBy(
    await db.select().from(modelPrices).orderBy(desc(modelPrices.validFrom)),
    (price) => price.modelId,
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    createdAt: row.createdAt,
    prices: (prices.get(row.id) ?? []).map(
      ({ validFrom, input, cacheRead, cacheWrite, output, source, updatedAt }) => ({
        validFrom,
        input,
        cacheRead,
        cacheWrite,
        output,
        source,
        updatedAt,
      }),
    ),
  }));
}

/** Alle Websuchpreise, nach Harness und neuestem Gültig-ab-Datum. */
export async function listWebSearchPrices(db: Database): Promise<WebSearchPriceView[]> {
  const rows = await db
    .select()
    .from(webSearchPrices)
    .orderBy(asc(webSearchPrices.harness), desc(webSearchPrices.validFrom));
  return rows.map(({ harness, validFrom, perSearch, source, updatedAt }) => ({
    harness,
    validFrom,
    perSearch,
    source,
    updatedAt,
  }));
}
