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
 * Ob zwei Verbindungs-URLs dieselbe PostgreSQL-Datenbank bezeichnen: gleicher Host (localhost, 127.0.0.1 und ::1
 * gelten als derselbe), gleicher Port (ohne Angabe 5432) und gleicher Datenbankname. Schema-Schreibweise
 * (`postgres://`/`postgresql://`), Zugangsdaten und Query-Optionen spielen keine Rolle. Nicht lesbare URLs gelten
 * vorsichtshalber als dieselbe Datenbank.
 */
export function sameDatabase(a: string, b: string): boolean {
  const left = databaseIdentity(a);
  const right = databaseIdentity(b);
  if (!left || !right) return true;
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function databaseIdentity(url: string): { host: string; port: string; database: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Ohne Host in der URL nimmt pg den Host aus `?host=` (z. B. ein Socket-Verzeichnis), sonst localhost.
  const rawHost = parsed.hostname || parsed.searchParams.get("host") || "localhost";
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  const port = parsed.port || parsed.searchParams.get("port") || "5432";
  // Ohne Datenbanknamen verbindet PostgreSQL mit der gleichnamigen Datenbank des Nutzers.
  const database =
    decodeURIComponent(parsed.pathname.replace(/^\//, "")) || decodeURIComponent(parsed.username);
  return { host: LOOPBACK_HOSTS.has(host) ? "loopback" : host, port, database };
}

/** Wirft, wenn `url` keine Test-Datenbank (Name mit Endung `_e2e`) bezeichnet. */
export function assertE2eDatabaseUrl(url: string | undefined): void {
  const name = url ? databaseName(url) : "";
  if (!name.endsWith(E2E_DATABASE_SUFFIX)) {
    throw new Error(
      `Keine Test-Datenbank: „${name || "(keine)"}“. E2E-Tests laufen nur gegen eine Datenbank mit der Endung ${E2E_DATABASE_SUFFIX}.`,
    );
  }
}

function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}
