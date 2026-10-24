import { describe, expect, test } from "vitest";
import { estimateRunCost, estimateUnitCost, type PriceTable } from "./cost";

/**
 * Seam 2 – Kostenfunktion: Tokens + Websuchen + Preistabelle (gültig zum Laufdatum) → geschätzte Kosten
 * zum API-Listenpreis oder „unbekannt“.
 */

// Haiku 5.5 laut Preisliste (Recherche docs/research/kosten-claude-code.md, 1.3), 1h-Cache-Write.
const haiku = { input: 0.1, cacheRead: 0.01, cacheWrite: 0.2, output: 0.5 };

function table(overrides: Partial<PriceTable> = {}): PriceTable {
  return {
    models: { "claude-haiku-5-5": [{ validFrom: "2026-10-01", ...haiku }] },
    webSearch: { claude_code: [{ validFrom: "2026-10-01", perSearch: 0.01 }] },
    ...overrides,
  };
}

const runDate = new Date("2026-10-23T10:00:00Z");

describe("geschätzte Kosten einer Unit", () => {
  test("Tokens × Preis je Kategorie, Cache-Read und Cache-Write mit eigenem Tarif (Testaufruf 1 der Recherche)", () => {
    const cost = estimateUnitCost(
      {
        harness: "claude_code",
        model: "claude-haiku-5-5",
        at: runDate,
        tokens: {
          inputTokens: 1159,
          cacheReadTokens: 649,
          cacheWriteTokens: 2441,
          outputTokens: 23,
          reasoningTokens: 0,
        },
        webSearches: 0,
      },
      table(),
    );
    expect(cost.kind).toBe("estimated");
    expect(cost.kind === "estimated" && cost.usd).toBeCloseTo(0.00062209, 10);
  });

  test("nimmt den Preis mit dem jüngsten Gültig-ab-Datum bis zum Laufdatum; ab dem Tag selbst gilt der neue Preis", () => {
    const prices = table({
      models: {
        m: [
          { validFrom: "2026-01-01", input: 1, cacheRead: null, cacheWrite: null, output: 0 },
          { validFrom: "2026-11-01", input: 3, cacheRead: null, cacheWrite: null, output: 0 },
          { validFrom: "2026-06-01", input: 2, cacheRead: null, cacheWrite: null, output: 0 },
        ],
      },
    });
    const at = (iso: string) =>
      estimateUnitCost(
        { harness: "fake", model: "m", at: new Date(iso), tokens: million, webSearches: 0 },
        prices,
      );

    expect(at("2026-05-31T23:59:59Z")).toEqual({ kind: "estimated", usd: 1 });
    expect(at("2026-06-01T00:00:00Z")).toEqual({ kind: "estimated", usd: 2 });
    expect(at("2026-10-23T12:00:00Z")).toEqual({ kind: "estimated", usd: 2 });
    expect(at("2026-11-01T08:00:00Z")).toEqual({ kind: "estimated", usd: 3 });
    expect(at("2025-12-31T12:00:00Z")).toMatchObject({ kind: "unknown" });
  });

  test("Websuchen kosten den gültigen Preis pro Suche des Harness (Testaufruf 2 der Recherche)", () => {
    const cost = estimateUnitCost(
      {
        harness: "claude_code",
        model: "claude-haiku-5-5",
        at: runDate,
        tokens: {
          inputTokens: 15428,
          cacheReadTokens: 6289,
          cacheWriteTokens: 3752,
          outputTokens: 2158,
          reasoningTokens: 1554,
        },
        webSearches: 1,
      },
      table(),
    );
    expect(cost.kind === "estimated" && cost.usd).toBeCloseTo(0.01343509, 10);
  });

  test("Websuchpreis gilt je Harness und ab seinem Datum", () => {
    const prices = table({
      models: { m: [{ validFrom: "2026-01-01", input: 0, cacheRead: null, cacheWrite: null, output: 0 }] },
      webSearch: {
        codex: [
          { validFrom: "2026-01-01", perSearch: 0.025 },
          { validFrom: "2026-10-23", perSearch: 0.03 },
        ],
        claude_code: [{ validFrom: "2026-01-01", perSearch: 0.01 }],
      },
    });
    const searches = (iso: string) =>
      estimateUnitCost(
        { harness: "codex", model: "m", at: new Date(iso), tokens: million, webSearches: 4 },
        prices,
      );
    expect(searches("2026-10-22T23:00:00Z")).toEqual({ kind: "estimated", usd: 0.1 });
    expect(searches("2026-10-23T00:00:00Z")).toEqual({ kind: "estimated", usd: 0.12 });
  });
});

describe("fehlender Preis → unbekannt", () => {
  const base = {
    harness: "claude_code",
    model: "claude-haiku-5-5",
    at: runDate,
    tokens: million,
    webSearches: 0,
  } as const;

  test("Modell ohne Preis (auch ein Eintrag ohne Preis) ist unbekannt, nicht 0", () => {
    expect(estimateUnitCost({ ...base, model: "gpt-reserve" }, table())).toMatchObject({ kind: "unknown" });
    expect(
      estimateUnitCost({ ...base, model: "gpt-reserve" }, table({ models: { "gpt-reserve": [] } })),
    ).toMatchObject({ kind: "unknown" });
  });

  test("Websuchen ohne Websuchpreis des Harness sind unbekannt; ohne Suche braucht es keinen", () => {
    const withoutSearchPrice = table({ webSearch: {} });
    expect(estimateUnitCost({ ...base, webSearches: 2 }, withoutSearchPrice)).toMatchObject({
      kind: "unknown",
    });
    expect(estimateUnitCost({ ...base, webSearches: 0 }, withoutSearchPrice)).toEqual({
      kind: "estimated",
      usd: 0.1,
    });
    expect(estimateUnitCost({ ...base, webSearches: null }, withoutSearchPrice)).toEqual({
      kind: "estimated",
      usd: 0.1,
    });
  });

  test("Cache-Tokens ohne Cache-Tarif sind unbekannt; ohne Cache-Tokens stört der fehlende Tarif nicht", () => {
    const noCachePrices = table({
      models: {
        "claude-haiku-5-5": [{ validFrom: "2026-01-01", ...haiku, cacheRead: null, cacheWrite: null }],
      },
    });
    const cached = (cacheReadTokens: number, cacheWriteTokens: number) =>
      estimateUnitCost({ ...base, tokens: { ...million, cacheReadTokens, cacheWriteTokens } }, noCachePrices);
    expect(cached(10, 0)).toMatchObject({ kind: "unknown" });
    expect(cached(0, 10)).toMatchObject({ kind: "unknown" });
    expect(cached(0, 0)).toEqual({ kind: "estimated", usd: 0.1 });
  });

  test("ohne gemeldete Tokens sind die Kosten unbekannt", () => {
    expect(estimateUnitCost({ ...base, tokens: null }, table())).toMatchObject({ kind: "unknown" });
  });
});

describe("Kosten eines Laufs", () => {
  const prices = table({
    models: { m: [{ validFrom: "2026-01-01", input: 1, cacheRead: 0.1, cacheWrite: null, output: 2 }] },
  });
  const unit = (
    unitId: string,
    status: "pending" | "running" | "done" | "failed",
    tokens: typeof million | null,
    nativeCostUsd: number | null,
  ) => ({ unitId, status, tokens, webSearches: 0, nativeCostUsd });
  const run = (units: ReturnType<typeof unit>[]) => ({
    configuration: { harness: "fake", model: "m" } as const,
    createdAt: runDate,
    units,
  });

  test("summiert geschätzte und native Kosten der Units mit Ergebnis; offene Units zählen nicht", () => {
    const costs = estimateRunCost(
      run([
        unit("a", "done", million, 0.9),
        unit("b", "failed", { ...million, inputTokens: 500_000, outputTokens: 250_000 }, 1.1),
        unit("c", "pending", null, null),
        unit("d", "running", null, null),
      ]),
      prices,
    );
    expect(costs.units.a).toEqual({ kind: "estimated", usd: 1 });
    expect(costs.units.b).toEqual({ kind: "estimated", usd: 1 });
    expect(costs.units.c).toBeNull();
    expect(costs.units.d).toBeNull();
    expect(costs.estimated).toEqual({ kind: "estimated", usd: 2 });
    expect(costs.native).toEqual({ usd: 2, unitsWithout: 0 });
  });

  test("ist eine Unit unbekannt, ist der Lauf unbekannt, mit bekanntem Teilbetrag und Zahl der unbekannten Units", () => {
    const costs = estimateRunCost(
      run([
        unit("a", "done", million, 0.9),
        unit("b", "failed", null, null),
        unit("c", "done", { ...million, cacheWriteTokens: 5 }, null),
      ]),
      prices,
    );
    expect(costs.units.b).toMatchObject({ kind: "unknown" });
    expect(costs.units.c).toMatchObject({ kind: "unknown" });
    expect(costs.estimated).toMatchObject({ kind: "unknown", knownUsd: 1, unknownUnits: 2 });
    expect(costs.native).toEqual({ usd: 0.9, unitsWithout: 2 });
  });

  test("ohne Preis fürs Modell sind alle Units unbekannt; ohne native Angaben bleibt die native Summe leer", () => {
    const costs = estimateRunCost(
      { ...run([unit("a", "done", million, null)]), configuration: { harness: "fake", model: "neu" } },
      prices,
    );
    expect(costs.estimated).toMatchObject({ kind: "unknown", knownUsd: 0, unknownUnits: 1 });
    expect(costs.native).toEqual({ usd: null, unitsWithout: 1 });
  });
});

/** Eine Million nicht gecachte Input-Tokens, sonst nichts. */
const million = {
  inputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: null,
};
