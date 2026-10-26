import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Gemeinsamer Typ für die Postgres-Datenbank der App und die PGlite-Datenbank der Tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Verzeichnis der von drizzle-kit erzeugten Migrationen. */
export const MIGRATIONS_FOLDER = "drizzle";
