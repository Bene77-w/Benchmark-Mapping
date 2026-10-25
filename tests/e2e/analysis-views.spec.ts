import { expect, test } from "@playwright/test";
import { runIds, startRun } from "./helpers";

/**
 * Auswertung: Kategorie-Diagramm, Heatmap und Verlauf mit Fake-Läufen. `rangliste-a` liefert für
 * house--veterans-affairs--health einen Format-Fehler, `rangliste-b` mappt Ethics falsch. Die Worktree-Datenbank
 * sammelt Läufe früherer Durchläufe; geprüft wird über die eigenen Lauf-IDs und ein eindeutiges Effort.
 */

const FORMAT_ERROR_UNIT = "house--veterans-affairs--health";
const SCORED_UNIT = "house--ethics";

test("Kategorien, Heatmap und Verlauf folgen den Filtern; Heatmap-Zellen führen zur Unit-Detailansicht", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const effort = `ansicht-${stamp}`;
  const a1 = await startRun(page, "rangliste-a", effort);
  const a2 = await startRun(page, "rangliste-a", effort);
  const b = await startRun(page, "rangliste-b", effort);

  await page.goto("/auswertung");
  const rows = page.getByTestId("leaderboard-row");
  await expect(rows.and(page.locator(`[data-run-id="${b}"]`))).toBeVisible();

  // Heatmap: dieselben Läufe wie die Rangliste (je Konfiguration der neueste, a1 ist ersetzt).
  const heatmapRows = page.getByTestId("heatmap-row");
  expect(await runIds(heatmapRows)).toEqual(await runIds(rows));
  await expect(heatmapRows.and(page.locator(`[data-run-id="${a1}"]`))).toHaveCount(0);

  // Format-Fehler erkennbar anders als bewertete Antworten (auch Score 0).
  const rowA2 = heatmapRows.and(page.locator(`[data-run-id="${a2}"]`));
  const formatCell = rowA2.locator(`[data-unit-id="${FORMAT_ERROR_UNIT}"]`);
  await expect(formatCell).toHaveAttribute("data-kind", "format_error");
  await expect(formatCell).toContainText("F");
  await expect(rowA2.locator(`[data-unit-id="${SCORED_UNIT}"]`)).toHaveAttribute("data-kind", "score");

  // Kategorie-Diagramm: ohne Auswahl die besten Läufe; b hinzunehmen ändert die Adresse, Filter bleiben.
  const chart = page.getByTestId("category-chart");
  await expect(chart).toBeVisible();
  const toggleB = page.getByTestId("category-toggle").and(page.locator(`[data-run-id="${b}"]`));
  if ((await toggleB.getAttribute("data-selected")) !== "true") {
    // Höchstens vier Läufe: bei voller Auswahl erst einen anderen abwählen.
    const selected = page.getByTestId("category-toggle").and(page.locator('[data-selected="true"]'));
    if ((await selected.count()) >= 4) {
      await selected.first().click();
      await expect(selected).toHaveCount(3);
    }
    await toggleB.click();
    await expect(page).toHaveURL(new RegExp(`laeufe=[0-9%2C]*${b}`));
  }
  await expect(toggleB).toHaveAttribute("data-selected", "true");
  await expect(chart.getByTestId("category-bar").and(page.locator(`[data-run-id="${b}"]`))).not.toHaveCount(
    0,
  );

  // Verlauf: je Konfiguration alle Läufe nach Datum, nicht nur der neueste.
  await page
    .getByTestId("history-configuration")
    .filter({ hasText: "rangliste-a" })
    .filter({ hasText: effort })
    .click();
  await expect(page).toHaveURL(/verlauf=\d+/);
  const points = page.getByTestId("history-point");
  await expect(points).toHaveCount(2);
  expect(await points.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-run-id")))).toEqual([
    a1,
    a2,
  ]);

  // Filter „beste Stufe je Modell“: Heatmap und Verlauf folgen der Rangliste.
  await page.getByRole("link", { name: "beste Stufe je Modell" }).click();
  await expect(page).toHaveURL(/effort=beste/);
  await expect(rows.filter({ hasText: "rangliste-a" })).toHaveCount(1);
  expect(await runIds(heatmapRows)).toEqual(await runIds(rows));
  await expect(page.getByTestId("history-configuration")).toHaveCount(await rows.count());

  // Klick auf eine Heatmap-Zelle öffnet die Unit-Detailansicht des Laufs.
  await page.getByRole("link", { name: "alle Stufen" }).click();
  await rowA2.locator(`[data-unit-id="${SCORED_UNIT}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/laeufe/${a2}/units/${SCORED_UNIT}$`));
  await expect(page.getByTestId("unit-detail-status").filter({ visible: true })).toBeVisible();
});
