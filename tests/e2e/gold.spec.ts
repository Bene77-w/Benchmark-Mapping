import { expect, type Page, test } from "@playwright/test";

const AVIATION = "house--transportation-and-infrastructure--aviation";
const ETHICS = "house--ethics";

async function addUnit(page: Page, unitId: string, category: string) {
  await page.getByLabel("Unit", { exact: true }).fill(unitId);
  await page.getByLabel("Kategorie").selectOption(category);
  await page.getByRole("button", { name: "Unit hinzufügen" }).click();
  await expect(page.getByTestId("gold-unit-row").filter({ hasText: unitId })).toBeVisible();
}

async function startProposalRun(page: Page, model: string, effort: string) {
  await page.getByLabel("Harness").selectOption("fake");
  await page.getByLabel("Modell").fill(model);
  await page.getByLabel("Effort").fill(effort);
  await page.getByRole("button", { name: "Vorschlagslauf starten" }).click();
  await expect(page.getByText(/Vorschlagslauf #\d+ angelegt/)).toBeVisible();
}

test("Gold-Review mit Fake-Vorschlägen abschließen", async ({ page }) => {
  // Eigenes Effort je Testlauf, damit die Konfigurationen neu sind.
  const effort = `e2e-${Date.now()}`;
  await page.goto("/gold");
  await expect(page.getByRole("heading", { name: "Gold", exact: true })).toBeVisible();
  // Ein Entwurf aus einem abgebrochenen Testlauf wird verworfen.
  const discard = page.getByRole("button", { name: "Entwurf verwerfen" });
  if (await discard.isVisible()) {
    await discard.click();
    await expect(page.getByTestId("draft-count")).toHaveText("0");
  }

  await addUnit(page, AVIATION, "a");
  await addUnit(page, ETHICS, "c");
  await expect(page.getByTestId("draft-count")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Gold-Review abschließen" })).toBeDisabled();

  await startProposalRun(page, "vorschlag-a", effort);
  await startProposalRun(page, "vorschlag-b", effort);
  await expect(page.getByTestId("proposal-run-row")).toHaveCount(2);
  await expect(page.getByTestId("proposal-run-status")).toHaveText(["abgeschlossen", "abgeschlossen"], {
    timeout: 20_000,
  });

  // Review Aviation: zwei Vorschläge nebeneinander, Unterschiede hervorgehoben.
  await page.getByRole("link", { name: AVIATION }).click();
  await expect(page.getByRole("heading", { name: "Subcommittee on Aviation" })).toBeVisible();
  await expect(page.getByTestId("proposal")).toHaveCount(2);
  await expect(page.getByTestId("proposal").nth(1)).toContainText(
    "Ob Flugzeughersteller direkt betroffen sind",
  );
  await expect(page.getByTestId("proposal").nth(1)).toContainText("https://www.faa.gov/aircraft/air_cert");
  const row = (industryId: string) =>
    page.locator(`[data-testid="review-industry"][data-industry="${industryId}"]`);
  await expect(row("airlines")).toHaveAttribute("data-difference", "false");
  await expect(row("airports-air-services")).toHaveAttribute("data-difference", "true");
  await expect(row("aerospace-defense")).toHaveAttribute("data-difference", "true");

  await page.getByLabel("Klasse airlines").selectOption("positiv");
  await page.getByLabel("Klasse airports-air-services").selectOption("positiv");
  await page.getByLabel("Klasse aerospace-defense").selectOption("vertretbar");
  await page.getByLabel("web_only aerospace-defense").check();
  // Zusätzliche Industry, die kein Vorschlag nennt.
  await page.getByLabel("Weitere Industry").fill("travel-services");
  await page.getByLabel("Klasse der weiteren Industry").selectOption("vertretbar");
  await page.getByLabel("Notiz (Begründung)").fill("Hersteller nur über FAA-Zulassung");
  await page.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(page.getByTestId("decision-form").getByText("Gespeichert")).toBeVisible();

  // Review Ethics: die Vorschläge sind sich uneinig; Entscheidung no_mapping.
  await page.goto(`/gold/units/${ETHICS}`);
  await expect(page.getByTestId("decisions-differ")).toBeVisible();
  await page.getByRole("checkbox", { name: "no_mapping" }).check();
  await page.getByRole("button", { name: "Entscheidung speichern" }).click();
  await expect(page.getByTestId("decision-form").getByText("Gespeichert")).toBeVisible();

  await page.goto("/gold");
  await expect(page.getByTestId("gold-check")).toContainText("Prüfung bestanden");
  await page.getByRole("button", { name: "Gold-Review abschließen" }).click();

  await expect(page).toHaveURL(/\/gold\/versionen\/gold-v\d+$/);
  const label = await page.getByTestId("gold-version-label").textContent();
  expect(label).toMatch(/^gold-v\d+$/);
  await expect(page.getByTestId("gold-version-unit")).toHaveCount(2);
  await expect(page.getByTestId("gold-version-unit").filter({ hasText: AVIATION })).toContainText(
    "aerospace-defense (vertretbar, web_only), airlines (positiv), airports-air-services (positiv), travel-services (vertretbar)",
  );
  await expect(page.getByTestId("gold-version-unit").filter({ hasText: ETHICS })).toContainText("no_mapping");

  await page.goto("/gold");
  await expect(page.getByTestId("gold-current")).toContainText(`${label} eingefroren`);
  await expect(page.getByTestId("draft-count")).toHaveText("0");
});
