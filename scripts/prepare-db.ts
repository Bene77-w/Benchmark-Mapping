/**
 * Bereitet die lokale Datenbank vor: Migrationen anwenden, den eingecheckten Snapshot und den datierten
 * models.dev-Auszug (Preistabelle) laden (beides idempotent).
 *
 *   pnpm db:prepare      (läuft auch automatisch vor `pnpm dev`)
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { MIGRATIONS_FOLDER } from "@/server/db/database";
import * as schema from "@/server/db/schema";
import { databaseUrl } from "@/server/db/url";
import { readModelsDevSnapshot } from "@/server/pricing/models-dev";
import { loadModelsDevSnapshot } from "@/server/pricing/store";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { loadSnapshot } from "@/server/snapshot/store";

const pool = new Pool({ connectionString: databaseUrl() });
try {
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const snapshot = await readSnapshotFile(SNAPSHOT_PATH);
  const { created } = await loadSnapshot(db, snapshot);
  console.log(
    `Datenbank bereit; Snapshot ${snapshot.version} (${snapshot.contentHash.slice(0, 12)}) ${created ? "geladen" : "war schon geladen"}.`,
  );
  const modelsDev = await readModelsDevSnapshot();
  const { prices } = await loadModelsDevSnapshot(db, modelsDev);
  console.log(`Preistabelle: models.dev ${modelsDev.retrievedAt}, ${prices} Preise neu geladen.`);
} finally {
  await pool.end();
}
