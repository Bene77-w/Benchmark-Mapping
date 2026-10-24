import type { Harness, TokenUsage } from "@/server/harness/adapter";
import type { UnitResultStatus } from "@/server/runs/model";

/**
 * Kostenfunktion (rein): geschätzte Kosten zum API-Listenpreis = Tokens × gültiger Preis + Websuchen ×
 * Preis pro Suche. Fehlt ein nötiger Preis oder melden die Daten keine Tokens, ist das Ergebnis „unbekannt“
 * (nie still 0).
 */

/** Preise eines Modells in USD pro Million Tokens, gültig ab `validFrom` (Datum `YYYY-MM-DD`, UTC). */
export interface ModelPrice {
  validFrom: string;
  input: number;
  /** `null` = kein Tarif bekannt; nur ein Problem, wenn Tokens dieser Kategorie anfallen. */
  cacheRead: number | null;
  cacheWrite: number | null;
  /** Gilt für alle Output-Tokens einschließlich Reasoning. */
  output: number;
}

/** Preis pro Websuche in USD je Harness, gültig ab `validFrom` (Datum `YYYY-MM-DD`, UTC). */
export interface WebSearchPrice {
  validFrom: string;
  perSearch: number;
}

/** Preistabelle: Preise je Modell-ID und Websuchpreise je Harness, jeweils mit Gültig-ab-Datum. */
export interface PriceTable {
  models: Record<string, ModelPrice[]>;
  webSearch: Partial<Record<Harness, WebSearchPrice[]>>;
}

export interface UnitCostInput {
  harness: Harness;
  /** Modell-ID der Konfiguration (Schlüssel der Preistabelle). */
  model: string;
  /** Laufdatum: maßgeblich ist der Preis mit dem jüngsten Gültig-ab-Datum bis zu diesem Zeitpunkt. */
  at: Date;
  tokens: TokenUsage | null;
  /** `null` = vom Harness nicht gemeldet, zählt als keine Suche. */
  webSearches: number | null;
}

export type CostEstimate = { kind: "estimated"; usd: number } | { kind: "unknown"; reason: string };

const PER_MILLION = 1_000_000;

export function estimateUnitCost(input: UnitCostInput, table: PriceTable): CostEstimate {
  const { tokens } = input;
  if (!tokens) return unknown("keine Tokens gemeldet");
  const price = validAt(table.models[input.model] ?? [], input.at);
  if (!price) return unknown(`kein Preis für Modell ${input.model}`);
  if (tokens.cacheReadTokens > 0 && price.cacheRead === null) {
    return unknown(`kein Cache-Read-Preis für Modell ${input.model}`);
  }
  if (tokens.cacheWriteTokens > 0 && price.cacheWrite === null) {
    return unknown(`kein Cache-Write-Preis für Modell ${input.model}`);
  }

  const usd =
    (tokens.inputTokens * price.input +
      tokens.cacheReadTokens * (price.cacheRead ?? 0) +
      tokens.cacheWriteTokens * (price.cacheWrite ?? 0) +
      tokens.outputTokens * price.output) /
    PER_MILLION;
  const searches = input.webSearches ?? 0;
  if (searches === 0) return { kind: "estimated", usd };
  const searchPrice = validAt(table.webSearch[input.harness] ?? [], input.at);
  if (!searchPrice) return unknown(`kein Websuchpreis für ${input.harness}`);
  return { kind: "estimated", usd: usd + searches * searchPrice.perSearch };
}

function validAt<T extends { validFrom: string }>(prices: T[], at: Date): T | null {
  let best: T | null = null;
  for (const price of prices) {
    if (Date.parse(`${price.validFrom}T00:00:00Z`) > at.getTime()) continue;
    if (!best || price.validFrom > best.validFrom) best = price;
  }
  return best;
}

function unknown(reason: string): CostEstimate {
  return { kind: "unknown", reason };
}

/** Was die Kostenrechnung von einem Lauf braucht (passt zu `RunView`). */
export interface RunCostInput {
  configuration: { harness: Harness; model: string };
  /** Laufdatum für die Preiswahl. */
  createdAt: Date;
  units: {
    unitId: string;
    status: UnitResultStatus;
    tokens: TokenUsage | null;
    webSearches: number | null;
    nativeCostUsd: number | null;
  }[];
}

export type RunCostTotal =
  | { kind: "estimated"; usd: number }
  /** Mindestens eine Unit ist unbekannt: `knownUsd` = Summe der bekannten Units. */
  | { kind: "unknown"; knownUsd: number; unknownUnits: number; reasons: string[] };

export interface RunCosts {
  /** Je Unit; `null`, solange die Unit kein Ergebnis hat (offen oder laufend). */
  units: Record<string, CostEstimate | null>;
  estimated: RunCostTotal;
  /** Summe der nativen Kostenangaben zur Gegenprobe; `usd` ist `null`, wenn keine Unit eine hat. */
  native: { usd: number | null; unitsWithout: number };
}

/** Geschätzte und native Kosten eines Laufs, je Unit und als Summe über die Units mit Ergebnis. */
export function estimateRunCost(run: RunCostInput, table: PriceTable): RunCosts {
  const units: RunCosts["units"] = {};
  let knownUsd = 0;
  let unknownUnits = 0;
  const reasons = new Set<string>();
  let nativeUsd: number | null = null;
  let unitsWithout = 0;
  for (const unit of run.units) {
    if (unit.status !== "done" && unit.status !== "failed") {
      units[unit.unitId] = null;
      continue;
    }
    const cost = estimateUnitCost(
      {
        harness: run.configuration.harness,
        model: run.configuration.model,
        at: run.createdAt,
        tokens: unit.tokens,
        webSearches: unit.webSearches,
      },
      table,
    );
    units[unit.unitId] = cost;
    if (cost.kind === "estimated") {
      knownUsd += cost.usd;
    } else {
      unknownUnits += 1;
      reasons.add(cost.reason);
    }
    if (unit.nativeCostUsd === null) unitsWithout += 1;
    else nativeUsd = (nativeUsd ?? 0) + unit.nativeCostUsd;
  }
  return {
    units,
    estimated:
      unknownUnits === 0
        ? { kind: "estimated", usd: knownUsd }
        : { kind: "unknown", knownUsd, unknownUnits, reasons: [...reasons] },
    native: { usd: nativeUsd, unitsWithout },
  };
}
