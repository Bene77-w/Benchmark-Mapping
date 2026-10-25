/**
 * Legt die Test-Datenbank der GUI-Tests leer neu an (Playwright ruft das vor dem Dev-Server auf; danach
 * füllt `pnpm db:prepare` sie mit Migrationen, Snapshot und Preisen).
 *
 *   DATABASE_URL=postgres://…/benchmark_e2e pnpm e2e:reset-db
 *
 * Bricht ab, wenn DATABASE_URL keine Test-Datenbank (Name mit Endung `_e2e`) bezeichnet; die Datenbank
 * der App wird nie gelöscht.
 */
import { Client } from "pg";
import { assertE2eDatabaseUrl } from "@/server/db/url";

const url = process.env.DATABASE_URL;
assertE2eDatabaseUrl(url);
const target = new URL(url as string);
const name = decodeURIComponent(target.pathname.slice(1));
const admin = new URL(target);
admin.pathname = "/postgres";

const client = new Client({ connectionString: admin.toString() });
await client.connect();
try {
  const quoted = `"${name.replaceAll('"', '""')}"`;
  await client.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${quoted}`);
  console.log(`Test-Datenbank ${name} neu angelegt.`);
} finally {
  await client.end();
}
