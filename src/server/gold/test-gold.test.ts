import { expect, test } from "vitest";
import { readTestGold, TEST_GOLD_PATH } from "./test-gold";

test("das Test-Gold aus den Fixtures ist lesbar und hat Kategorien", async () => {
  const gold = await readTestGold(TEST_GOLD_PATH);
  expect(gold.version).toBe("test-gold");
  expect(gold.units.find((unit) => unit.unitId === "house--ethics")).toEqual({
    unitId: "house--ethics",
    category: "c",
    noMapping: true,
    industries: [],
  });
  expect(gold.units.every((unit) => unit.industries.every((entry) => entry.webOnly === false))).toBe(true);
});
