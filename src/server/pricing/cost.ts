import type { Harness, TokensByModel, TokenUsage } from "@/server/harness/adapter";
import type { UnitResultStatus } from "@/server/runs/model";

/**
 * Kostenfunktion (rein): geschätzte Kosten zum API-Listenpreis = Tokens × gültiger Preis + Websuchen ×
 * Preis pro Suche. Fehlt ein nötiger Preis oder melden die Daten keine Tokens, ist das Ergebnis „unbekannt“
 * (nie still 0). Maßgeblich ist das Modell laut Harness: meldet er Tokens je Modell, wird jedes Modell
 * einzeln bepreist; sonst gilt das gemeldete Modell (löst Aliase wie `haiku` auf), ohne dessen Preis das
 * konfigurierte.
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
  /** Modell-ID der Konfiguration (Schlüssel der Preistabelle; kann ein Alias sein). */
  model: string;
  /** Modell-ID laut Harness; hat sie einen Preis, gilt dieser statt dem des konfigurierten Modells. */
  modelReported?: string | null;
  /** Tokens je Modell laut Harness; jedes Modell wird mit seinem eigenen Preis bepreist. */
  tokensByModel?: TokensByModel | null;
  /** Laufdatum: maßgeblich ist der Preis mit dem jüngsten Gültig-ab-Datum bis zu diesem Zeitpunkt. */
  at: Date;
  tokens: TokenUsage | null;
  /**
   * `null` = vom Harness nicht gemeldet: unbekannt, sobald der Harness einen Websuchpreis hat (es könnten
   * Suchen angefallen sein); ohne Websuchpreis zählt es wie keine Suche.
   */
  webSearches: number | null;
}

export type CostEstimate = { kind: "estimated"; usd: number } | { kind: "unknown"; reason: string };

const PER_MILLION = 1_000_000;

export function estimateUnitCost(input: UnitCostInput, table: PriceTable): CostEstimate {
  const { tokens } = input;
  if (!tokens) return unknown("keine Tokens gemeldet");
  const parts = input.tokensByModel
    ? Object.entries(input.tokensByModel)
    : [[pricedModel(input, table), tokens] as const];
  let usd = 0;
  for (const [model, modelTokens] of parts) {
    const cost = tokenCost(model, modelTokens, input.at, table);
    if (cost.kind === "unknown") return cost;
    usd += cost.usd;
  }
  const searchPrice = validAt(table.webSearch[input.harness] ?? [], input.at);
  if (input.webSearches === null) {
    return searchPrice ? unknown(`Websuchen nicht gemeldet (${input.harness})`) : { kind: "estimated", usd };
  }
  if (input.webSearches === 0) return { kind: "estimated", usd };
  if (!searchPrice) return unknown(`kein Websuchpreis für ${input.harness}`);
  return { kind: "estimated", usd: usd + input.webSearches * searchPrice.perSearch };
}

/** Modell, dessen Preis gilt: das gemeldete, wenn es einen Preis hat, sonst das konfigurierte. */
function pricedModel(input: UnitCostInput, table: PriceTable): string {
  const reported = input.modelReported;
  if (reported && validAt(table.models[reported] ?? [], input.at)) return reported;
  return input.model;
}

function tokenCost(model: string, tokens: TokenUsage, at: Date, table: PriceTable): CostEstimate {
  const price = validAt(table.models[model] ?? [], at);
  if (!price) return unknown(`kein Preis für Modell ${model}`);
  if (tokens.cacheReadTokens > 0 && price.cacheRead === null) {
    return unknown(`kein Cache-Read-Preis für Modell ${model}`);
  }
  if (tokens.cacheWriteTokens > 0 && price.cacheWrite === null) {
    return unknown(`kein Cache-Write-Preis für Modell ${model}`);
  }
  const usd =
    (tokens.inputTokens * price.input +
      tokens.cacheReadTokens * (price.cacheRead ?? 0) +
      tokens.cacheWriteTokens * (price.cacheWrite ?? 0) +
      tokens.outputTokens * price.output) /
    PER_MILLION;
  return { kind: "estimated", usd };
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
    tokensByModel?: TokensByModel | null;
    webSearches: number | null;
    nativeCostUsd: number | null;
    modelReported?: string | null;
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
        modelReported: unit.modelReported,
        at: run.createdAt,
        tokens: unit.tokens,
        tokensByModel: unit.tokensByModel,
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
    const native = nativeCostOf(unit);
    if (native === null) unitsWithout += 1;
    else nativeUsd = (nativeUsd ?? 0) + native;
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

/**
 * Native Kostenangabe einer Unit zur Gegenprobe. Bei einer fehlgeschlagenen Unit gilt 0 als keine Angabe
 * (`null`): Claude Code meldet nach einem Fehler oft `total_cost_usd: 0`, obwohl Kosten angefallen sein
 * können. Bei einer fertigen Unit bleibt 0 ein Wert (z. B. OpenCode bei Abo- oder Free-Modellen).
 */
export function nativeCostOf(unit: {
  status: UnitResultStatus;
  nativeCostUsd: number | null;
}): number | null {
  if (unit.nativeCostUsd === 0 && unit.status === "failed") return null;
  return unit.nativeCostUsd;
}
