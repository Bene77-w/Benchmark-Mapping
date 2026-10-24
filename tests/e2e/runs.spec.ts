import { expect, type Page, test } from "@playwright/test";

// Ein Worker führt die Läufe nacheinander aus; parallele Tests würden aufeinander warten.
test.describe.configure({ mode: "serial" });

/** Legt über das Formular einen Lauf mit dem Fake-Harness an (Szenario = Modell) und öffnet ihn. */
async function startFakeRun(page: Page, scenario: string, parallelism: number): Promise<string> {
  // Eigenes Effort je Testlauf, damit die Konfiguration neu ist und der Test wiederholbar bleibt.
  const effort = `e2e-${Date.now()}`;
  await page.goto("/laeufe");
  await expect(page.getByRole("heading", { name: "Läufe", exact: true })).toBeVisible();
  await expect(page.getByTestId("gold-version")).toHaveText("test-gold");

  await page.getByLabel("Harness").selectOption("fake");
  await page.getByLabel("Modell").fill(scenario);
  await page.getByLabel("Effort").fill(effort);
  await page.getByLabel("Modus").selectOption("text_only");
  await page.getByLabel("Parallelität").fill(String(parallelism));
  await page.getByLabel("Timeout pro Unit (Minuten)").fill("5");
  await page.getByRole("button", { name: "Lauf starten" }).click();

  await expect(page).toHaveURL(/\/laeufe\/\d+$/);
  await expect(page.getByTestId("run-configuration")).toContainText(`Fake (Test) · ${scenario} · ${effort}`);
  await expect(page.getByTestId("progress-total")).toHaveText("5");
  return effort;
}

test("Lauf mit Fake-Harness starten, bewerten und Konfiguration erneut starten", async ({ page }) => {
  const effort = await startFakeRun(page, "standard", 2);
  const runUrl = page.url();
  await expect(page.getByTestId("run-status")).toHaveText("abgeschlossen", { timeout: 20_000 });
  await expect(page.getByTestId("progress-done")).toHaveText("4");
  await expect(page.getByTestId("progress-failed")).toHaveText("1");
  await expect(page.getByTestId("progress-running")).toHaveText("0");
  await expect(page.getByTestId("run-score")).toHaveText("0.533");
  await expect(page.getByTestId("run-interval")).toContainText("Bootstrap-Intervall");
  await expect(page.getByTestId("evaluation-gold")).toHaveText("test-gold");
  await expect(page.getByTestId("run-format-errors")).toHaveText("1");
  await expect(page.getByTestId("run-violations")).toHaveText("0");
  await expect(page.getByTestId("run-evidence-fidelity")).toHaveText("100.0 %");
  await expect(page.getByTestId("violation-row")).toHaveCount(7);
  await expect(page.getByTestId("category-row").filter({ hasText: "c – no_mapping" })).toContainText("1.000");
  await expect(
    page.getByTestId("unit-row").filter({ hasText: "house--veterans-affairs--health" }),
  ).toContainText("invalid_json");

  // Unit-Detailansicht: Antwort, Gold, Abweichungen, Regelverstöße und Rohprotokoll.
  await page.getByRole("link", { name: "house--agriculture--livestock-dairy-and-poultry" }).click();
  await expect(
    page.getByRole("heading", { name: "Subcommittee on Livestock, Dairy, and Poultry" }),
  ).toBeVisible();
  await expect(page.getByTestId("unit-detail-score")).toHaveText("0.667");
  await expect(page.getByTestId("answer-decision")).toHaveText("mapped");
  await expect(page.getByTestId("assignment-row")).toContainText(
    "all livestock, poultry, dairy, and seafood",
  );
  await expect(page.getByTestId("gold-industries")).toContainText("packaged-foods");
  await expect(page.getByTestId("deviation-matched")).toContainText("farm-products");
  await expect(page.getByTestId("deviation-missing")).toContainText("packaged-foods");
  await expect(page.getByTestId("unit-detail-raw")).toContainText('"unit_id"');
  await expect(page.getByTestId("unit-detail-meta")).toContainText("4800 / 31000 / 1200 / 410 / 120");
  await page.getByRole("link", { name: /Lauf #/ }).click();
  await expect(page).toHaveURL(runUrl);

  await page.goto("/laeufe");
  const configuration = page.getByTestId("configuration-row").filter({ hasText: effort });
  await expect(configuration).toContainText("1");
  await configuration.getByRole("button", { name: "Erneut starten" }).click();
  await expect(page).toHaveURL(/\/laeufe\/\d+$/);
  expect(page.url()).not.toBe(runUrl);
  await expect(page.getByTestId("run-configuration")).toContainText(effort);
  await expect(page.getByTestId("run-status")).toHaveText("abgeschlossen", { timeout: 20_000 });
});

test("Lauf live verfolgen, abbrechen und fortsetzen, ohne fertige Units erneut aufzurufen", async ({
  page,
}) => {
  // Szenario „langsam“: 3 s je Aufruf, damit der Lauf auch bei kaltem Dev-Server sichtbar läuft.
  test.setTimeout(90_000);
  await startFakeRun(page, "langsam", 1);

  // Die Seite aktualisiert sich ohne Neuladen.
  await expect(page.getByTestId("progress-running")).toHaveText("1", { timeout: 30_000 });
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("abgebrochen");
  await expect(page.getByRole("button", { name: "Fortsetzen" })).toBeVisible();
  await expect(page.getByTestId("run-score")).toHaveCount(0);
  // Der beim Abbruch laufende Aufruf wird noch gespeichert, danach startet nichts mehr.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("progress-running")).toHaveText("0", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  await page.getByRole("button", { name: "Fortsetzen" }).click();
  await expect(page.getByTestId("run-status")).toHaveText("abgeschlossen", { timeout: 40_000 });
  await expect(page.getByTestId("progress-done")).toHaveText("4");
  await expect(page.getByTestId("progress-failed")).toHaveText("1");
  await expect(page.getByTestId("run-score")).toHaveText("0.533");
  // Jede Unit wurde genau einmal aufgerufen, die mit ungültigem JSON zweimal (Wiederholversuch).
  const rows = page.getByTestId("unit-row");
  await expect(
    rows.filter({ hasText: "house--veterans-affairs--health" }).getByTestId("unit-attempts"),
  ).toHaveText("2");
  await expect(
    rows.filter({ hasNotText: "house--veterans-affairs--health" }).getByTestId("unit-attempts"),
  ).toHaveText(["1", "1", "1", "1"]);
});
