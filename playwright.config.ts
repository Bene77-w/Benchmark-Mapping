import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./src/server/db/url";

// GUI-Tests in einer eigenen Umgebung: eigene Datenbank (`benchmark_e2e`, bei jedem Aufruf leer neu angelegt),
// eigener Dev-Server auf E2E_APP_PORT (eigenes Build-Verzeichnis `.next-e2e`) und eigener Worker (führt die
// Läufe mit dem Fake-Harness aus). Ein laufender Server wird nie wiederverwendet; die Daten der App bleiben
// unberührt. Voraussetzung: `docker compose up -d` (Datenbankserver auf DB_PORT bzw. E2E_DB_PORT).
// Läufe nutzen im Test das Test-Gold (TEST_GOLD_PATH) statt der neuesten Gold-Version der Datenbank.
const port = Number(process.env.E2E_APP_PORT ?? 3001);
if (process.env.APP_PORT && Number(process.env.APP_PORT) === port) {
  throw new Error(`E2E_APP_PORT (${port}) muss sich von APP_PORT unterscheiden.`);
}
const baseURL = `http://127.0.0.1:${port}`;
const env = {
  DATABASE_URL: e2eDatabaseUrl(process.env),
  APP_PORT: String(port),
  NEXT_DIST_DIR: ".next-e2e",
  TEST_GOLD_PATH: "tests/fixtures/test-gold.json",
};

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  reporter: "list",
  // Der Dev-Server kompiliert Seiten und Server Actions beim ersten Aufruf (global-setup.ts wärmt die Seiten
  // vor); mit kaltem `.next-e2e` dauern die ersten Server Actions parallel laufender Specs trotzdem lange.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /gold\.spec\.ts/ },
    // Gold-Review nach den übrigen Tests: das Kompilieren der großen Gold-Seiten im Dev-Server bremst sonst
    // parallele Navigationen über deren 5-s-Grenzen hinaus.
    {
      name: "gold",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /gold\.spec\.ts/,
      dependencies: ["chromium"],
    },
  ],
  // Playwright startet die Server nacheinander: erst Datenbank zurücksetzen + Dev-Server, dann den Worker.
  webServer: [
    {
      command: "pnpm e2e:reset-db && pnpm dev",
      url: `${baseURL}/snapshot`,
      // Nie einen fremden Server nutzen: ist der Port belegt, bricht Playwright ab.
      reuseExistingServer: false,
      timeout: 180_000,
      env,
    },
    {
      // Ohne URL: Playwright startet ihn immer und beendet ihn am Ende; er nutzt nur die Test-Datenbank.
      command: "pnpm worker",
      wait: { stdout: /Worker bereit/ },
      timeout: 60_000,
      env,
    },
  ],
});
