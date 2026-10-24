import { readFile } from "node:fs/promises";
import { z } from "zod";
import { GOLD_CATEGORIES } from "./model";

/**
 * Kandidaten für das Gold-Set aus `docs/goldset/kandidaten.md` als Hilfe für die Auswahl in der App (Code wie
 * „A1“, Kategorie aus dem Abschnitt, `recommended` = Teil der empfohlenen 30er-Auswahl). Keine feste Auswahl.
 */
export const GOLD_CANDIDATES_PATH = "data/goldset/kandidaten.json";

const candidatesFileSchema = z.object({
  source: z.string(),
  note: z.string().optional(),
  candidates: z.array(
    z.object({
      code: z.string().min(1),
      unitId: z.string().min(1),
      category: z.enum(GOLD_CATEGORIES),
      recommended: z.boolean(),
    }),
  ),
});
export type GoldCandidate = z.infer<typeof candidatesFileSchema>["candidates"][number];

export async function readGoldCandidates(file: string = GOLD_CANDIDATES_PATH): Promise<GoldCandidate[]> {
  return candidatesFileSchema.parse(JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")))
    .candidates;
}
