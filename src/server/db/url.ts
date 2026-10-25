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
 * `127.0.0.1:${E2E_DB_PORT:-DB_PORT:-5432}`. Bricht ab, wenn das keine Test-Datenbank ist oder die
 * Datenbank der App wäre — die Tests verwerfen Entwürfe und legen Gold-Versionen an.
 */
export function e2eDatabaseUrl(env: Environment = process.env): string {
  const url =
    env.E2E_DATABASE_URL ??
    `postgres://benchmark:benchmark@127.0.0.1:${env.E2E_DB_PORT ?? env.DB_PORT ?? "5432"}/benchmark${E2E_DATABASE_SUFFIX}`;
  assertE2eDatabaseUrl(url);
  if (url === databaseUrl(env)) {
    throw new Error(`Die Test-Datenbank ${url} ist die Datenbank der App; E2E-Tests brauchen eine eigene.`);
  }
  return url;
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
