import { expect, test } from "@playwright/test";

test("Lauf mit Fake-Harness starten, Fortschritt live sehen und Konfiguration erneut starten", async ({
  page,
}) => {
  // Eigenes Effort je Testlauf, damit die Konfiguration neu ist und der Test wiederholbar bleibt.
  const effort = `e2e-${Date.now()}`;
  await page.goto("/laeufe");
  await expect(page.getByRole("heading", { name: "Läufe", exact: true })).toBeVisible();
  await expect(page.getByTestId("gold-version")).toHaveText("test-gold");

  await page.getByLabel("Harness").selectOption("fake");
  await page.getByLabel("Modell").fill("standard");
  await page.getByLabel("Effort").fill(effort);
  await page.getByLabel("Modus").selectOption("text_only");
  await page.getByLabel("Parallelität").fill("2");
  await page.getByLabel("Timeout pro Unit (Minuten)").fill("5");
  await page.getByRole("button", { name: "Lauf starten" }).click();

  await expect(page).toHaveURL(/\/laeufe\/\d+$/);
  const runUrl = page.url();
  await expect(page.getByTestId("run-configuration")).toContainText(`Fake (Test) · standard · ${effort}`);
  await expect(page.getByTestId("progress-total")).toHaveText("5");
  // Der Worker arbeitet mit Parallelität 2; die Seite aktualisiert sich ohne Neuladen.
  await expect(page.getByTestId("progress-running")).toHaveText(/^[12]$/, { timeout: 15_000 });
  await expect(page.getByTestId("run-status")).toHaveText("abgeschlossen", { timeout: 20_000 });
  await expect(page.getByTestId("progress-done")).toHaveText("4");
  await expect(page.getByTestId("progress-failed")).toHaveText("1");
  await expect(page.getByTestId("progress-running")).toHaveText("0");
  await expect(page.getByTestId("run-score")).toHaveText("0.533");
  await expect(
    page.getByTestId("unit-row").filter({ hasText: "house--veterans-affairs--health" }),
  ).toContainText("invalid_json");

  await page.goto("/laeufe");
  const configuration = page.getByTestId("configuration-row").filter({ hasText: effort });
  await expect(configuration).toContainText("1");
  await configuration.getByRole("button", { name: "Erneut starten" }).click();
  await expect(page).toHaveURL(/\/laeufe\/\d+$/);
  expect(page.url()).not.toBe(runUrl);
  await expect(page.getByTestId("run-configuration")).toContainText(effort);
  await expect(page.getByTestId("run-status")).toHaveText("abgeschlossen", { timeout: 20_000 });
});
