import { defineConfig, devices } from "@playwright/test";

// GUI-Tests gegen den Dev-Server und einen eigenen Worker (führt die Läufe mit dem Fake-Harness aus).
// Voraussetzung: `docker compose up -d` (Datenbank auf DB_PORT).
// Läufe nutzen im Test das Test-Gold (TEST_GOLD_PATH) statt der neuesten Gold-Version der Datenbank; ein
// bereits laufender Dev-Server muss deshalb mit derselben Variable gestartet sein.
const port = Number(process.env.APP_PORT ?? 3000);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
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
  webServer: [
    {
      command: "pnpm dev",
      url: `http://localhost:${port}/snapshot`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { TEST_GOLD_PATH: "tests/fixtures/test-gold.json" },
    },
    {
      // Ohne URL: Playwright startet ihn immer und beendet ihn am Ende; weitere Worker stören nicht.
      command: "pnpm worker",
      wait: { stdout: /Worker bereit/ },
      timeout: 60_000,
    },
  ],
});
