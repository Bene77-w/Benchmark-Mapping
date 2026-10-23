import { defineConfig, devices } from "@playwright/test";

// GUI-Tests gegen den Dev-Server und einen eigenen Worker (führt die Läufe mit dem Fake-Harness aus).
// Voraussetzung: `docker compose up -d` (Datenbank auf DB_PORT).
const port = Number(process.env.APP_PORT ?? 3000);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm dev",
      url: `http://localhost:${port}/snapshot`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Ohne URL: Playwright startet ihn immer und beendet ihn am Ende; weitere Worker stören nicht.
      command: "pnpm worker",
      wait: { stdout: /Worker bereit/ },
      timeout: 60_000,
    },
  ],
});
