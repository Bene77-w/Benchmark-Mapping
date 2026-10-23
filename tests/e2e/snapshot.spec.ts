import { expect, test } from "@playwright/test";

test("Snapshot-Seite: Units und Taxonomie durchsuchen, Bereinigungen sehen", async ({ page }) => {
  await page.goto("/snapshot");
  await expect(page.getByText("225 Units (davon 9 name_only), 145 Industries")).toBeVisible();
  await expect(page.getByTestId("unit")).toHaveCount(225);

  await page.getByRole("searchbox", { name: "Suche" }).fill("joint economic");
  await page.getByRole("button", { name: "Suchen" }).click();
  await expect(page.getByTestId("unit")).toHaveCount(1);
  const jec = page.getByTestId("unit").first();
  await expect(jec.getByRole("heading", { name: "Joint Economic Committee" })).toBeVisible();
  await expect(jec.getByText("Deutscher Text")).toBeVisible();
  await expect(jec.getByRole("deletion")).toContainText("20 Mitglieder");
  await expect(jec.getByRole("insertion")).toContainText("It shall be the function of the joint committee");

  await page.getByRole("link", { name: "Taxonomie" }).click();
  await page.getByRole("searchbox", { name: "Suche" }).fill("passenger airline");
  await page.getByRole("button", { name: "Suchen" }).click();
  await expect(page.getByTestId("industry")).toHaveCount(1);
  await expect(page.getByTestId("industry")).toContainText("Airlines");
  await expect(page.getByTestId("industry")).toContainText("Industrials");
});
