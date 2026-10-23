import { expect, test } from "@playwright/test";

test("Prompt-Vorschau: System- und User-Prompt je Unit und Modus samt Hash", async ({ page }) => {
  await page.goto("/prompt");
  await expect(page.getByRole("heading", { name: "Benchmark-Prompt" })).toBeVisible();

  await page.getByLabel("Unit").selectOption("senate--finance--health-care");
  await page.getByLabel("Lauf").selectOption("benchmark/text_only");
  await page.getByRole("button", { name: "Anzeigen" }).click();

  await expect(page.getByTestId("prompt-version")).toHaveText("prompt-v1");
  const promptHash = page.getByTestId("prompt-hash");
  await expect(promptHash).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId("unit-prompt-hash")).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId("system-prompt")).toContainText("# Aufgabe");
  await expect(page.getByTestId("system-prompt")).toContainText(/keine\s+Websuche/);
  const userPrompt = page.getByTestId("user-prompt");
  await expect(userPrompt).toContainText("## unit_id: senate--finance--health-care");
  await expect(userPrompt).toContainText("Zustaendigkeitstext: nicht vorhanden.");
  const textOnlyHash = await promptHash.textContent();

  await page.getByLabel("Lauf").selectOption("proposal/web");
  await page.getByRole("button", { name: "Anzeigen" }).click();
  await expect(page.getByTestId("system-prompt")).toContainText("Referenzlabel");
  await expect(promptHash).not.toHaveText(textOnlyHash ?? "");
  await expect(page.getByLabel("Unit")).toHaveValue("senate--finance--health-care");
});
