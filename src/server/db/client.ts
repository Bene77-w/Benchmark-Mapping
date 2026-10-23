import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Database } from "./database";
import * as schema from "./schema";
import { databaseUrl } from "./url";

const globalForDb = globalThis as unknown as { benchmarkDb?: Database };

/** Datenbank der App (PostgreSQL aus docker-compose.yml); ein Pool pro Prozess, auch bei Hot Reload. */
export function getDatabase(): Database {
  globalForDb.benchmarkDb ??= drizzle({ client: new Pool({ connectionString: databaseUrl() }), schema });
  return globalForDb.benchmarkDb;
}
