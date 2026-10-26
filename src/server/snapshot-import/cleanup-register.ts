import { readFile } from "node:fs/promises";
import { z } from "zod";
import { type Cleanup, cleanupKindSchema, type SnapshotUnit } from "@/server/snapshot/model";

const ruleBase = {
  unitId: z.string().min(1),
  kind: cleanupKindSchema,
  /** Warum die Stelle bereinigt wird; bei Ersetzungen auch die Quelle des neuen Wortlauts. */
  reason: z.string().min(1),
};

/**
 * Eine Regel des Bereinigungsregisters. Sie wirkt auf den normalisierten Zuständigkeitstext einer Unit:
 * - `replace` ersetzt eine Textstelle, die genau einmal vorkommen muss;
 * - `name_only` verwirft einen Text, der über den Namen der Unit hinaus nichts belegt.
 */
export const cleanupRuleSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...ruleBase, action: z.literal("replace"), before: z.string().min(1), after: z.string() }),
  z.strictObject({ ...ruleBase, action: z.literal("name_only") }),
]);

export const cleanupRegisterSchema = z.array(cleanupRuleSchema);

export type CleanupRule = z.infer<typeof cleanupRuleSchema>;

export async function readCleanupRegister(file: string): Promise<CleanupRule[]> {
  return cleanupRegisterSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

/** Wendet das Register in seiner Reihenfolge an. Jede Regel, die nicht greift, ist ein Fehler. */
export function applyCleanups(
  units: readonly SnapshotUnit[],
  register: readonly CleanupRule[],
): { units: SnapshotUnit[]; cleanups: Cleanup[] } {
  const byId = new Map(units.map((unit) => [unit.unitId, { ...unit }]));
  const cleanups: Cleanup[] = [];
  for (const [index, rule] of register.entries()) {
    const fail = (message: string): never => {
      throw new Error(`Bereinigungsregister, Regel ${index + 1} (${rule.unitId}): ${message}`);
    };
    const unit = byId.get(rule.unitId) ?? fail("Unit gibt es im Korpus nicht");
    const text = unit.jurisdictionText ?? fail("Unit hat keinen Zuständigkeitstext");

    if (rule.action === "name_only") {
      unit.inputBasis = "name_only";
      unit.jurisdictionText = null;
      cleanups.push({ unitId: rule.unitId, kind: rule.kind, before: text, after: "", reason: rule.reason });
      continue;
    }

    const occurrences = text.split(rule.before).length - 1;
    if (occurrences !== 1)
      fail(`Textstelle kommt ${occurrences}-mal statt genau einmal vor: "${rule.before}"`);
    unit.jurisdictionText = text.replace(rule.before, () => rule.after);
    const { unitId, kind, before, after, reason } = rule;
    cleanups.push({ unitId, kind, before, after, reason });
  }
  return { units: units.map((unit) => byId.get(unit.unitId) as SnapshotUnit), cleanups };
}
