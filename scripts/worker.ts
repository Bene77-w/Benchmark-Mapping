/**
 * Worker-Prozess: führt die in der GUI angelegten Läufe aus, unabhängig vom Dev-Server.
 *
 *   pnpm worker      (Datenbank wie die App: DATABASE_URL oder localhost:${DB_PORT:-5432})
 *
 * Beenden mit Strg+C. Ein dabei laufender Lauf bleibt im Status „läuft“; sobald sein Lebenszeichen älter
 * als 60 s ist, übernimmt ihn der nächste Worker und führt die laufenden und offenen Units aus (fertige nicht).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/server/db/schema";
import { databaseUrl } from "@/server/db/url";
import { createAdapterRegistry } from "@/server/harness/registry";
import { runWorker } from "@/server/runs/worker";

const pool = new Pool({ connectionString: databaseUrl() });
const db = drizzle({ client: pool, schema });
const adapters = createAdapterRegistry();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`Worker beendet (${signal}).`);
    process.exit(0);
  });
}

console.log(`Worker bereit; Harnesses: ${Object.keys(adapters).join(", ")}.`);
await runWorker(
  db,
  { adapters },
  {
    onRun: (runId) => console.log(`Lauf ${runId} bearbeitet.`),
    onError: (error) => console.error("Worker-Fehler:", error instanceof Error ? error.message : error),
  },
);
