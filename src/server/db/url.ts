/**
 * Verbindungs-URL der lokalen Datenbank: `DATABASE_URL` oder der Container aus docker-compose.yml
 * auf `localhost:${DB_PORT:-5432}`.
 */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_URL ?? `postgres://benchmark:benchmark@localhost:${env.DB_PORT ?? "5432"}/benchmark`;
}
