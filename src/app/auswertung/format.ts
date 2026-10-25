import type { AnalysisEntry, CostPerUnit, XAxis } from "@/server/analysis/leaderboard";
import { formatUsd } from "@/server/pricing/format";

export const X_AXIS_LABELS: Record<XAxis, string> = {
  cost: "Kosten pro Unit",
  tokens: "Tokens pro Unit",
  duration: "Dauer pro Unit",
};

export function costLabel(cost: CostPerUnit): string {
  return cost.kind === "estimated" ? formatUsd(cost.usd) : "unbekannt";
}

export function tokensLabel(tokens: number | null): string {
  return tokens === null ? "unbekannt" : Math.round(tokens).toLocaleString("de-DE");
}

export function durationLabel(ms: number | null): string {
  if (ms === null) return "unbekannt";
  if (ms < 60_000) return `${(ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s`;
  return `${(ms / 60_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} min`;
}

/** Wert auf der x-Achse als Text (Achsenbeschriftung, Tooltip). */
export function axisValueLabel(axis: XAxis, value: number): string {
  if (axis === "cost") return formatUsd(value);
  if (axis === "tokens") return tokensLabel(value);
  return durationLabel(value);
}

export function entryAxisLabel(entry: AnalysisEntry, axis: XAxis): string {
  if (axis === "cost") return costLabel(entry.costPerUnit);
  if (axis === "tokens") return tokensLabel(entry.tokensPerUnit);
  return durationLabel(entry.durationPerUnitMs);
}

/** Farbe eines gewählten Laufs im Kategorie-Diagramm: Slot nach Position in der Auswahl (höchstens vier). */
export function seriesColor(index: number): string {
  return `var(--viz-series-${index + 1})`;
}
