/**
 * Legt einen datierten Auszug des models.dev-Katalogs unter data/pricing/ an.
 *
 *   pnpm pricing:import              (lädt https://models.dev/api.json)
 *   pnpm pricing:import <api.json>   (liest einen bereits geladenen Katalog)
 *
 * Danach `MODELS_DEV_SNAPSHOT_PATH` in src/server/pricing/models-dev.ts auf die neue Datei setzen; beim
 * nächsten `pnpm db:prepare` kommen ihre Preise (gültig ab Abrufdatum) zur Preistabelle hinzu.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractModelsDevSnapshot, MODELS_DEV_URL } from "@/server/pricing/models-dev";

const input = process.argv[2];
const catalog = input
  ? JSON.parse(await readFile(input, "utf8"))
  : await fetch(MODELS_DEV_URL).then((response) => {
      if (!response.ok) throw new Error(`${MODELS_DEV_URL}: HTTP ${response.status}`);
      return response.json();
    });
const retrievedAt = new Date().toISOString().slice(0, 10);
const snapshot = extractModelsDevSnapshot(catalog, retrievedAt);
const target = path.join("data", "pricing", `models-dev-${retrievedAt}.json`);
await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`);
const count = Object.values(snapshot.providers).reduce((sum, models) => sum + Object.keys(models).length, 0);
console.log(`${target}: ${count} Modelle von ${Object.keys(snapshot.providers).join(", ")}`);
