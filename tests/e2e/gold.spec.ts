import { expect, type Page, test } from "@playwright/test";

const AVIATION = "house--transportation-and-infrastructure--aviation";
const ETHICS = "house--ethics";

// Beide Tests bearbeiten den einzigen Gold-Entwurf: nacheinander.
test.describe.configure({ mode: "serial" });

/** Stand der Neubewertung auf der sichtbaren Seite (Next behält die vorige Seite verborgen im DOM). */
function reevaluationStatus(page: Page) {
  return page.getByTestId("reevaluation-status").filter({ visible: true });
}

async function addUnit(page: Page, unitId: string, category: string) {
  await page.getByLabel("Unit", { exact: true }).fill(unitId);
  await page.getByLabel("Kategorie").selectOption(category);
  await page.getByRole("button", { name: "Unit hinzufügen" }).click();
  await expect(page.getByTestId("gold-unit-row").filter({ hasText: unitId })).toBeVisible();
}

async function startProposalRun(page: Page, model: string, effort: string, expectedRuns: number) {
  await page.getByLabel("Harness").selectOption("fake");
  await page.getByLabel("Modell").fill(model);
  await page.getByLabel("Effort").fill(effort);
  await page.getByRole("button", { name: "Vorschlagslauf starten" }).click();
  await expect(page.getByTestId("proposal-run-row")).toHaveCount(expectedRuns, { timeout: 15_000 });
}

test("Gold-Review mit Fake-Vorschlägen abschließen", async ({ page }) => {
  test.setTimeout(150_000);
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

  await startProposalRun(page, "vorschlag-a", effort, 1);
  await startProposalRun(page, "vorschlag-b", effort, 2);
  // Der Worker führt Läufe nacheinander aus; Läufe anderer Tests können vor den Vorschlagsläufen dran sein.
  await expect(page.getByTestId("proposal-run-status")).toHaveText(["abgeschlossen", "abgeschlossen"], {
    timeout: 90_000,
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

  // Neubewertung aller abgeschlossenen Benchmark-Läufe gegen die neue, aktuelle Gold-Version.
  await expect(reevaluationStatus(page)).toContainText(`Neubewertung gegen ${label}`);

  await page.goto("/gold");
  await expect(page.getByTestId("gold-current")).toContainText(`${label} eingefroren`);
  await expect(page.getByTestId("draft-count")).toHaveText("0");
  await expect(reevaluationStatus(page)).toContainText(`Neubewertung gegen ${label}`);
});

// Läuft nach der Gold-Review oben (seriell): deren Gold-Version ist der Ausgangspunkt.
test("eine Gold-Version als Ausgangspunkt bearbeiten und als neue Version abschließen", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/gold");
  const base = (await page.getByTestId("gold-current").getByRole("link").textContent()) ?? "";
  expect(base).toMatch(/^gold-v\d+$/);

  await page.getByRole("button", { name: `${base} als Ausgangspunkt bearbeiten` }).click();
  await expect(page.getByTestId("draft-base")).toHaveText(base);
  await expect(page.getByTestId("draft-count")).toHaveText("2");
  // Unverändert entsteht keine neue Version.
  await expect(page.getByTestId("gold-check")).toContainText(`Keine Änderung gegenüber ${base}`);
  await expect(page.getByRole("button", { name: "Gold-Review abschließen" })).toBeDisabled();

  // Änderung: Ethics aus dem Gold-Set entfernen.
  await page
    .getByTestId("gold-unit-row")
    .filter({ hasText: ETHICS })
    .getByRole("button", { name: "Entfernen" })
    .click();
  await expect(page.getByTestId("draft-count")).toHaveText("1");
  await expect(page.getByTestId("gold-check")).toContainText("Prüfung bestanden");
  await page.getByRole("button", { name: "Gold-Review abschließen" }).click();

  await expect(page).toHaveURL(/\/gold\/versionen\/gold-v\d+$/);
  const label = await page.getByTestId("gold-version-label").textContent();
  expect(Number(label?.slice("gold-v".length))).toBe(Number(base.slice("gold-v".length)) + 1);
  await expect(page.getByTestId("gold-version-base")).toHaveText(base);
  await expect(page.getByTestId("gold-version-unit")).toHaveCount(1);
  await expect(reevaluationStatus(page)).toContainText(`Neubewertung gegen ${label}`);

  // Die Ausgangsversion bleibt unverändert gespeichert, ist aber nicht mehr aktuell.
  await page.goto(`/gold/versionen/${base}`);
  await expect(page.getByTestId("gold-version-unit")).toHaveCount(2);
  await expect(page.getByText(`die Auswertung nutzt ${label}`)).toBeVisible();
});
