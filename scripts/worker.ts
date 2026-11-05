/**
 * Worker-Prozess: führt die in der GUI angelegten Läufe aus, unabhängig vom Dev-Server.
 *
 *   pnpm worker      (Datenbank wie die App: DATABASE_URL oder 127.0.0.1:${DB_PORT:-5432})
 *
 * Beenden mit Strg+C; laufende CLI-Aufrufe werden mitbeendet. Ein dabei laufender Lauf bleibt im Status „läuft“;
 * sobald sein Lebenszeichen älter als 60 s ist, übernimmt ihn der nächste Worker und führt die laufenden und offenen Units aus (fertige nicht).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/server/db/schema";
import { databaseUrl } from "@/server/db/url";
import { killRunningClis } from "@/server/harness/cli-process";
import { createAdapterRegistry } from "@/server/harness/registry";
import { runWorker } from "@/server/runs/worker";

const pool = new Pool({ connectionString: databaseUrl() });
const db = drizzle({ client: pool, schema });
const adapters = createAdapterRegistry();

// Laufende CLI-Aufrufe laufen in eigenen Prozessgruppen und würden das Beenden sonst überleben (weitere Kosten,
// verworfenes Ergebnis). Sie werden sofort hart beendet und der Worker im selben Schritt, damit der Runner den
// Abbruch nicht mehr als Fehler der Unit speichert; der Lauf wird später übernommen.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    const killed = killRunningClis("SIGKILL");
    console.log(
      `Worker beendet (${signal})${killed > 0 ? `; ${killed} laufende CLI-Aufrufe abgebrochen` : ""}.`,
    );
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
