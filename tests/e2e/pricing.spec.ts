import { expect, type Page, test } from "@playwright/test";

/**
 * Preise in der GUI pflegen und geschätzte neben nativen Kosten eines Fake-Laufs sehen. Der Preis für das
 * Fake-Modell `standard` gilt ab 2000-01-01; der Test setzt ihn jedes Mal neu und bleibt so wiederholbar.
 */

async function savePrice(page: Page, price: { input: string; output: string }) {
  await page.goto("/modelle");
  await expect(page.getByRole("heading", { name: "Modelle und Preise" })).toBeVisible();
  const form = page.getByTestId("model-price-form");
  await form.getByLabel("Modell-ID").fill("standard");
  await form.getByLabel("Gültig ab").fill("2000-01-01");
  await form.getByLabel("Input").fill(price.input);
  await form.getByLabel("Cache-Read").fill("0.1");
  await form.getByLabel("Cache-Write").fill("2");
  await form.getByLabel("Output").fill(price.output);
  await form.getByRole("button", { name: "Preis speichern" }).click();
  await expect(form.getByRole("status")).toContainText("gespeichert");
  await expect(page.locator('[data-model-id="standard"]').first()).toContainText("2000-01-01");
}

test("Preis anlegen und ändern; Lauf zeigt geschätzte und native Kosten, Preisänderung wirkt auf die Anzeige", async ({
  page,
}) => {
  // Der Lauf wartet auf den einen Worker, den die Läufe aus runs.spec gleichzeitig belegen.
  test.setTimeout(90_000);
  await savePrice(page, { input: "1", output: "12" });

  await page.goto("/laeufe");
  await page.getByLabel("Harness").selectOption("fake");
  await page.getByLabel("Modell").fill("standard");
  await page.getByLabel("Effort").fill(`kosten-${Date.now()}`);
  await page.getByLabel("Modus").selectOption("text_only");
  await page.getByRole("button", { name: "Lauf starten" }).click();
  await expect(page).toHaveURL(/\/laeufe\/\d+$/);
  const runUrl = page.url();
  await expect(page.getByTestId("run-status")).toHaveText("abgeschlossen", { timeout: 30_000 });

  // Fixture-Tokens der 5 Units: 24 600 Input, 155 000 Cache-Read, 1 200 Cache-Write, 1 655 Output
  // → 0,0246 + 0,0155 + 0,0024 + 0,01986 = 0,06236 USD; dazu der Wiederholversuch der invalid_json-Unit
  // (5 600 · 1 + 31 000 · 0,1 + 95 · 12 = 9 840 µ$) → 0,0722 USD; nativ 0,0489 + 0,0089 = 0,0578 USD.
  await expect(page.getByTestId("run-cost-estimated")).toHaveText("$0.0722");
  await expect(page.getByText("geschätzt zum API-Listenpreis").first()).toBeVisible();
  await expect(page.getByTestId("run-cost-native")).toHaveText("$0.0578");
  // house--ethics: 3 900 · 1 + 31 000 · 0,1 + 180 · 12 = 9 160 µ$.
  const ethics = page.getByTestId("unit-row").filter({ hasText: "house--ethics" });
  await expect(ethics.getByTestId("unit-cost-estimated")).toHaveText("$0.0092");
  await expect(ethics.getByTestId("unit-cost-native")).toHaveText("$0.0071");
  // Dieselben Kosten auf der Unit-Detailseite, gleich gekennzeichnet.
  await ethics.getByRole("link", { name: "house--ethics" }).click();
  await expect(page.getByTestId("unit-detail-cost-estimated")).toHaveText("$0.0092");
  await expect(page.getByTestId("unit-detail-costs")).toContainText("geschätzt zum API-Listenpreis");
  await expect(page.getByTestId("unit-detail-cost-native")).toHaveText("$0.0071");

  // Preis ändern (gleiches Gültig-ab-Datum): Input 2 statt 1 → +(24 600 + 5 600) µ$ = 0,1024 USD.
  await savePrice(page, { input: "2", output: "12" });
  await page.goto(runUrl);
  await expect(page.getByTestId("run-cost-estimated")).toHaveText("$0.1024");
  await expect(page.getByTestId("run-cost-native")).toHaveText("$0.0578");
});
