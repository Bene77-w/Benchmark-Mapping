import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "./database";
import { MIGRATIONS_FOLDER } from "./database";
import * as schema from "./schema";

/**
 * Frische In-Memory-Postgres (PGlite) mit allen Migrationen, für Tests ohne Docker.
 * Jeder Aufruf liefert eine leere, unabhängige Datenbank.
 */
export async function createTestDatabase(): Promise<Database> {
  const db = drizzle({ client: new PGlite(), schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
