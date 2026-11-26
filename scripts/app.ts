/**
 * Startet alles mit einem Befehl und beendet App und Worker gemeinsam:
 *
 *   pnpm app
 *
 * 1. Datenbank-Container starten und warten, bis er bereit ist (`docker compose up -d --wait`).
 * 2. Datenbank vorbereiten (`pnpm db:prepare`).
 * 3. App (`next dev`, http://127.0.0.1:${APP_PORT:-3000}) und Worker gemeinsam starten.
 *
 * Strg+C beendet App und Worker (zweimal Strg+C: sofort hart). Endet einer der beiden von selbst, wird der
 * andere ebenfalls beendet. Der Datenbank-Container läuft weiter (`docker compose stop` beendet ihn).
 *
 * Umgebungsvariablen für den Worker (z. B. `CODEX_AUTH_HOME`, `OPENCODE_WEBSEARCH_PROVIDER`) lassen sich beim
 * Aufruf setzen oder dauerhaft in `.env.local` eintragen; Werte aus der Shell haben Vorrang.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { runTogether } from "./run-together";

const ENV_FILE = ".env.local";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function step(label: string, command: string, args: string[]): void {
  console.log(`▶ ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(
      `✖ ${label} fehlgeschlagen${result.error ? `: ${result.error.message}` : ` (Code ${result.status})`}.`,
    );
    process.exit(1);
  }
}

loadEnvFile(ENV_FILE);
// Farbige Ausgabe von Next.js trotz umgeleiteter Ausgabe, wenn das Terminal Farben kann.
if (process.stdout.isTTY && process.env.FORCE_COLOR === undefined) process.env.FORCE_COLOR = "1";

step("Datenbank starten", "docker", ["compose", "up", "-d", "--wait"]);
step("Datenbank vorbereiten", "pnpm", ["db:prepare"]);

const group = runTogether([
  { name: "app", command: "pnpm", args: ["--silent", "dev:next"] },
  { name: "worker", command: "pnpm", args: ["--silent", "worker"] },
]);

let signals = 0;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    signals += 1;
    if (signals === 1) {
      console.log("\nBeende App und Worker … (nochmal Strg+C: sofort)");
      group.stop();
    } else {
      group.stop("SIGKILL");
    }
  });
}

process.exitCode = await group.done;
console.log("App und Worker beendet.");
