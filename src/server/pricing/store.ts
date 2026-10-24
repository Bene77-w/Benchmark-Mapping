import type { Database } from "@/server/db/database";
import { modelPrices, models, webSearchPrices } from "@/server/db/schema";
import type { ModelPrice, PriceTable } from "./cost";
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

/** Die ganze Preistabelle für die Kostenfunktion. */
export async function getPriceTable(db: Database): Promise<PriceTable> {
  const table: PriceTable = { models: {}, webSearch: {} };
  for (const row of await db.select().from(modelPrices)) {
    const price: ModelPrice = {
      validFrom: row.validFrom,
      input: row.input,
      cacheRead: row.cacheRead,
      cacheWrite: row.cacheWrite,
      output: row.output,
    };
    (table.models[row.modelId] ??= []).push(price);
  }
  for (const row of await db.select().from(webSearchPrices)) {
    (table.webSearch[row.harness] ??= []).push({ validFrom: row.validFrom, perSearch: row.perSearch });
  }
  for (const prices of [...Object.values(table.models), ...Object.values(table.webSearch)]) {
    prices.sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1));
  }
  return table;
}
