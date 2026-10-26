import { Client } from "pg";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Verbindungs-URL der lokalen Datenbank: `DATABASE_URL` oder der Container aus docker-compose.yml
 * auf `127.0.0.1:${DB_PORT:-5432}` (Compose veröffentlicht den Port nur auf der Loopback-Adresse).
 */
export function databaseUrl(env: Environment = process.env): string {
  return env.DATABASE_URL ?? `postgres://benchmark:benchmark@127.0.0.1:${env.DB_PORT ?? "5432"}/benchmark`;
}

/** Endung, an der eine Test-Datenbank erkannt wird; nur solche Datenbanken setzt `pnpm test:e2e` zurück. */
export const E2E_DATABASE_SUFFIX = "_e2e";

/**
 * Datenbank der GUI-Tests (Playwright): `E2E_DATABASE_URL` oder eine eigene Datenbank `benchmark_e2e` auf
 * `127.0.0.1:${E2E_DB_PORT:-DB_PORT:-5432}`. Bricht ab, wenn das keine Test-Datenbank ist oder dieselbe
 * Datenbank wie die der App (`sameDatabase`) — die Tests verwerfen Entwürfe und legen Gold-Versionen an.
 */
export function e2eDatabaseUrl(env: Environment = process.env): string {
  const url =
    env.E2E_DATABASE_URL ??
    `postgres://benchmark:benchmark@127.0.0.1:${env.E2E_DB_PORT ?? env.DB_PORT ?? "5432"}/benchmark${E2E_DATABASE_SUFFIX}`;
  assertE2eDatabaseUrl(url);
  assertNotAppDatabase(url, databaseUrl(env));
  return url;
}

/**
 * Wirft, wenn `url` dieselbe Datenbank wie die der App (`appUrl`) bezeichnet oder diese unbekannt ist. Verglichen
 * wird die Identität laut `sameDatabase`, nicht die Schreibweise der URL. `pnpm e2e:reset-db` prüft das
 * unmittelbar vor dem Löschen erneut.
 */
export function assertNotAppDatabase(url: string, appUrl: string | undefined): void {
  if (!appUrl) {
    throw new Error("Die Datenbank der App ist unbekannt; ohne sie wird keine Test-Datenbank zurückgesetzt.");
  }
  if (sameDatabase(url, appUrl)) {
    throw new Error(`Die Test-Datenbank ${url} ist die Datenbank der App; E2E-Tests brauchen eine eigene.`);
  }
}

/**
 * Ob zwei Verbindungs-URLs dieselbe PostgreSQL-Datenbank bezeichnen. Maßgeblich ist das Ziel, mit dem `pg` sich
 * tatsächlich verbindet (`connectionTarget`, also auch `?host=`/`?port=` und PG*-Umgebungsvariablen): gleicher
 * Host (localhost, 127.0.0.1 und ::1 gelten als derselbe), gleicher Port und gleicher Datenbankname.
 * Schema-Schreibweise, Zugangsdaten und Optionen wie `sslmode` spielen keine Rolle. Nicht lesbare URLs gelten
 * vorsichtshalber als dieselbe Datenbank.
 */
export function sameDatabase(a: string, b: string): boolean {
  const left = connectionTarget(a);
  const right = connectionTarget(b);
  if (!left || !right) return true;
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Was `pg` aus Verbindungsangaben macht (`ConnectionParameters`; in den Typen von `pg` nicht enthalten). */
interface PgConnectionParameters {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
}

/**
 * Ziel einer Verbindungs-URL, ausgewertet vom installierten `pg` selbst (ohne Verbindung): Host (Loopback
 * vereinheitlicht), Port und Datenbank. `null`, wenn `pg` die URL nicht lesen kann.
 */
export function connectionTarget(url: string): { host: string; port: number; database: string } | null {
  let params: PgConnectionParameters;
  try {
    params = (
      new Client({ connectionString: url }) as unknown as { connectionParameters: PgConnectionParameters }
    ).connectionParameters;
  } catch {
    return null;
  }
  const host = (params.host ?? "localhost").toLowerCase().replace(/^\[|\]$/g, "");
  const database = params.database ?? params.user ?? "";
  if (!database || !params.port || Number.isNaN(params.port)) return null;
  return { host: LOOPBACK_HOSTS.has(host) ? "loopback" : host, port: params.port, database };
}

/**
 * Query-Parameter, mit denen eine URL ihr Ziel ändert (`pg` übernimmt sie vor Host, Port und Pfad); in der
 * URL einer Test-Datenbank verboten, damit das Ziel allein aus Host, Port und Pfad hervorgeht.
 */
const TARGET_QUERY_PARAMETERS = new Set([
  "host",
  "hostaddr",
  "port",
  "database",
  "dbname",
  "user",
  "service",
]);

/**
 * Wirft, wenn `url` keine Test-Datenbank (Name mit Endung `_e2e`, wie ihn `pg` auswertet) bezeichnet oder ihr
 * Ziel über Query-Parameter ändert.
 */
export function assertE2eDatabaseUrl(url: string | undefined): void {
  const overriding = url ? targetQueryParameters(url) : [];
  if (overriding.length > 0) {
    throw new Error(
      `Die Test-Datenbank ${url} ändert ihr Ziel über Query-Parameter (${overriding.join(", ")}); Host, Port und Datenbank gehören in die Adresse.`,
    );
  }
  const name = url ? (connectionTarget(url)?.database ?? "") : "";
  if (!name.endsWith(E2E_DATABASE_SUFFIX)) {
    throw new Error(
      `Keine Test-Datenbank: „${name || "(keine)"}“. E2E-Tests laufen nur gegen eine Datenbank mit der Endung ${E2E_DATABASE_SUFFIX}.`,
    );
  }
}

function targetQueryParameters(url: string): string[] {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return [...new URLSearchParams(query).keys()].filter((key) =>
    TARGET_QUERY_PARAMETERS.has(key.toLowerCase()),
  );
}
