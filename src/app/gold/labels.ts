import type { GoldUnit } from "@/server/gold/model";

export const selectClass = "h-8 rounded-lg border bg-background px-2 text-sm";

/** Kurzbeschreibung der Entscheidung einer Gold-Unit. */
export function decisionLabel(unit: GoldUnit): string {
  if (unit.noMapping) return unit.industries.length > 0 ? "no_mapping + Industries" : "no_mapping";
  if (unit.industries.length === 0) return "offen";
  const positiv = unit.industries.filter((industry) => industry.class === "positiv").length;
  return `${positiv} positiv, ${unit.industries.length - positiv} vertretbar`;
}
