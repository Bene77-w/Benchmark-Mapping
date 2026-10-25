import { expect, type Page, test } from "@playwright/test";
import { runIds, startRun } from "./helpers";

/**
 * Auswertung: Rangliste und Scatter-Plot mit Fake-Läufen. Szenario `rangliste-a` hat einen Preis (gültig ab
 * 2000-01-01, bei jedem Durchlauf neu gesetzt), `rangliste-b` nie – seine Kosten sind „unbekannt“. Die
 * übrigen Specs legen gleichzeitig Läufe an; geprüft wird deshalb über die eigenen Lauf-IDs.
 */

async function savePrice(page: Page) {
  await page.goto("/modelle");
  const form = page.getByTestId("model-price-form");
  await form.getByLabel("Modell-ID").fill("rangliste-a");
  await form.getByLabel("Gültig ab").fill("2000-01-01");
  await form.getByLabel("Input").fill("1");
  await form.getByLabel("Cache-Read").fill("0.1");
  await form.getByLabel("Cache-Write").fill("2");
  await form.getByLabel("Output").fill("12");
  await form.getByRole("button", { name: "Preis speichern" }).click();
  await expect(form.getByRole("status")).toContainText("gespeichert");
}

test("Rangliste und Scatter-Plot zeigen dieselben Läufe, reagieren auf Filter und führen zur Lauf-Detailansicht", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  await savePrice(page);
  const a1 = await startRun(page, "rangliste-a", `rang-${stamp}-1`);
  const a2 = await startRun(page, "rangliste-a", `rang-${stamp}-2`);
  const b = await startRun(page, "rangliste-b", `rang-${stamp}-1`);

  await page.goto("/auswertung");
  await expect(page.getByRole("heading", { name: "Auswertung" })).toBeVisible();
  const rows = page.getByTestId("leaderboard-row");
  const points = page.getByTestId("scatter-point");
  await expect(rows.and(page.locator(`[data-run-id="${b}"]`))).toBeVisible();

  // Dieselben Läufe in Rangliste und Scatter-Plot, absteigend nach Score.
  expect(await runIds(points)).toEqual(await runIds(rows));
  for (const id of [a1, a2, b]) expect(await runIds(rows)).toContain(id);
  const scores = await rows.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-score"))),
  );
  expect(scores).toEqual([...scores].sort((x, y) => y - x));

  // Unbekannte Kosten: in der Rangliste gekennzeichnet, im Plot außerhalb der Kostenachse statt bei 0.
  const rowB = rows.and(page.locator(`[data-run-id="${b}"]`));
  await expect(rowB.getByTestId("leaderboard-cost")).toContainText("unbekannt");
  await expect(page.getByTestId("scatter-unknown").locator(`[data-run-id="${b}"]`)).toBeVisible();
  await expect(page.getByTestId("scatter-known").locator(`[data-run-id="${a1}"]`)).toBeVisible();
  await expect(page.getByTestId("scatter-known").locator(`[data-run-id="${b}"]`)).toHaveCount(0);
  await expect(page.getByTestId("scatter-efficient")).toBeVisible();

  // x-Achse Tokens: rangliste-b hat Tokens und ist ein regulärer Punkt.
  await page.getByRole("link", { name: "Tokens pro Unit" }).click();
  await expect(page).toHaveURL(/x=tokens/);
  await expect(page.getByTestId("scatter-known").locator(`[data-run-id="${b}"]`)).toBeVisible();
  await expect(page.getByTestId("scatter-unknown")).toHaveCount(0);

  // Effort „beste Stufe je Modell“: je Modell eine Zeile, Plot folgt.
  await page.getByRole("link", { name: "beste Stufe je Modell" }).click();
  await expect(page).toHaveURL(/effort=beste/);
  await expect(rows.filter({ hasText: "rangliste-a" })).toHaveCount(1);
  expect(await runIds(points)).toEqual(await runIds(rows));
  await expect(page).toHaveURL(/x=tokens/);

  // Klick auf einen Lauf: aus der Rangliste und aus dem Plot zur Lauf-Detailansicht.
  await page.getByRole("link", { name: "alle Stufen" }).click();
  await rowB.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/laeufe/${b}$`));
  await page.goto("/auswertung");
  // Gleiche Fake-Ergebnisse liegen übereinander; der zuletzt gezeichnete Punkt liegt oben.
  const top = page.getByTestId("scatter-known").getByTestId("scatter-point").last();
  const topId = await top.getAttribute("data-run-id");
  await top.click();
  await expect(page).toHaveURL(new RegExp(`/laeufe/${topId}$`));
});

test("wiederholte Läufe einer Konfiguration: standardmäßig alle, Umschalter „nur neueste“ und „nur beste“ schließen sich aus", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Szenario `wiederholung`: house--ethics antwortet beim ersten Lauf richtig, danach falsch – der ältere
  // Lauf ist besser als der neuere.
  const effort = `wdh-${Date.now()}`;
  const first = await startRun(page, "wiederholung", effort);
  const second = await startRun(page, "wiederholung", effort);
  const rows = page.getByTestId("leaderboard-row");
  const points = page.getByTestId("scatter-point");
  const heatmapRows = page.getByTestId("heatmap-row");
  const shown = async () => {
    const ids = await runIds(rows);
    expect(await runIds(points)).toEqual(ids);
    expect(await runIds(heatmapRows)).toEqual(ids);
    return ids;
  };

  await page.goto("/auswertung");
  await expect(rows.and(page.locator(`[data-run-id="${second}"]`))).toBeVisible();
  expect(await shown()).toEqual(expect.arrayContaining([first, second]));

  const toggle = (value: "latest" | "best") =>
    page.getByTestId("per-configuration-toggle").and(page.locator(`[data-value="${value}"]`));
  await toggle("latest").click();
  await expect(page).toHaveURL(/je-konfiguration=neueste/);
  await expect(rows.and(page.locator(`[data-run-id="${first}"]`))).toHaveCount(0);
  expect(await shown()).toContain(second);

  await toggle("best").click();
  await expect(page).toHaveURL(/je-konfiguration=beste/);
  await expect(page).not.toHaveURL(/neueste/);
  await expect(toggle("latest")).not.toHaveAttribute("aria-current", "true");
  await expect(rows.and(page.locator(`[data-run-id="${second}"]`))).toHaveCount(0);
  expect(await shown()).toContain(first);

  // Erneuter Klick schaltet ab: wieder alle Läufe.
  await toggle("best").click();
  await expect(page).not.toHaveURL(/je-konfiguration/);
  await expect(rows.and(page.locator(`[data-run-id="${first}"]`))).toBeVisible();
  expect(await shown()).toEqual(expect.arrayContaining([first, second]));
});
