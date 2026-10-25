import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Startet einen Fake-Lauf ohne Web über das Formular und wartet auf den Abschluss; liefert die Lauf-ID. Der eine
 * Worker arbeitet die Läufe aller Specs nacheinander ab; mit kaltem `.next-e2e` (CPU durch das Kompilieren
 * ausgelastet) wartet ein Lauf deshalb deutlich länger als warm.
 */
export async function startRun(page: Page, model: string, effort: string): Promise<string> {
  await page.goto("/laeufe");
  await page.getByLabel("Harness").selectOption("fake");
  await page.getByLabel("Modell").fill(model);
  await page.getByLabel("Effort").fill(effort);
  await page.getByLabel("Modus").selectOption("text_only");
  await page.getByRole("button", { name: "Lauf starten" }).click();
  await expect(page).toHaveURL(/\/laeufe\/\d+$/);
  const id = page.url().split("/").at(-1) ?? "";
  await expect(page.getByTestId("run-status").filter({ visible: true })).toHaveText("abgeschlossen", {
    timeout: 120_000,
  });
  return id;
}

/** Lauf-IDs (`data-run-id`) der Elemente, sortiert. */
export async function runIds(locator: Locator): Promise<string[]> {
  return (
    await locator.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-run-id") ?? ""))
  ).sort();
}
