import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CATEGORIES, GOLD_CLASSES, type GoldVersion } from "@/server/scoring/model";

/**
 * Test-Gold aus den Fixtures: Units und Referenzantworten für den Durchstich mit dem Fake-Harness, bis
 * Gold-Versionen in der App entstehen (#11). Kein abgenommenes Gold; Pfad über `TEST_GOLD_PATH` änderbar.
 */
export const TEST_GOLD_PATH = process.env.TEST_GOLD_PATH ?? "tests/fixtures/test-gold.json";

const testGoldSchema = z.object({
  version: z.string().min(1),
  note: z.string().optional(),
  units: z
    .array(
      z.object({
        unitId: z.string().min(1),
        category: z.enum(CATEGORIES),
        noMapping: z.boolean(),
        industries: z.array(
          z.object({
            industryId: z.string().min(1),
            class: z.enum(GOLD_CLASSES),
            webOnly: z.boolean().default(false),
          }),
        ),
      }),
    )
    .min(1),
});

export type TestGold = GoldVersion;

export async function readTestGold(file: string = TEST_GOLD_PATH): Promise<TestGold> {
  const { version, units } = testGoldSchema.parse(
    JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")),
  );
  return { version, units };
}
