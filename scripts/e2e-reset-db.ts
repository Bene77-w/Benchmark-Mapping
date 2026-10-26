/**
 * Legt die Test-Datenbank der GUI-Tests leer neu an (Playwright ruft das vor dem Dev-Server auf; danach
 * füllt `pnpm db:prepare` sie mit Migrationen, Snapshot und Preisen).
 *
 *   DATABASE_URL=postgres://…/benchmark_e2e APP_DATABASE_URL=postgres://…/benchmark pnpm e2e:reset-db
 *
 * Bricht ab, wenn DATABASE_URL keine Test-Datenbank (Name mit Endung `_e2e`) bezeichnet oder dieselbe Datenbank
 * wie die der App (`APP_DATABASE_URL`, Pflicht; Playwright setzt sie) — die Datenbank der App wird nie gelöscht.
 */
import { Client } from "pg";
import { assertE2eDatabaseUrl, assertNotAppDatabase, connectionTarget } from "@/server/db/url";

const url = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
assertE2eDatabaseUrl(url);
assertNotAppDatabase(url as string, appUrl);
// Ziel so, wie pg es auswertet (die URL der Test-Datenbank ändert es nicht über Query-Parameter, siehe oben).
const target = connectionTarget(url as string);
if (!target) throw new Error(`Verbindungs-URL ${url} nicht lesbar`);
const name = target.database;
const admin = new URL(url as string);
admin.pathname = "/postgres";
const adminTarget = connectionTarget(admin.toString());
if (!adminTarget || adminTarget.host !== target.host || adminTarget.port !== target.port) {
  throw new Error("Die Verwaltungsverbindung zielt auf einen anderen Server als die Test-Datenbank.");
}

const client = new Client({ connectionString: admin.toString() });
await client.connect();
try {
  const quoted = `"${name.replaceAll('"', '""')}"`;
  // Unmittelbar vor dem Löschen noch einmal: nie die Datenbank der App.
  assertE2eDatabaseUrl(url);
  assertNotAppDatabase(url as string, appUrl);
  await client.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${quoted}`);
  console.log(`Test-Datenbank ${name} neu angelegt.`);
} finally {
  await client.end();
}
