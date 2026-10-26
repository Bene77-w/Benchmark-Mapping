import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Harness } from "@/server/harness/adapter";
import type { ModelPrice, WebSearchPrice } from "./cost";

/**
 * Datierter Auszug aus dem models.dev-Katalog (https://models.dev/api.json): nur die Anbieter, deren Modelle
 * die Harnesses nutzen, mit der Kostenangabe wie bei models.dev (USD pro Million Tokens). Er befüllt die
 * Preistabelle initial; neuer Auszug mit `pnpm pricing:import`.
 */

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const MODELS_DEV_FORMAT = "models-dev-prices-v1";
/** Anbieter im Auszug. Claude Code nutzt `anthropic`-, Codex `openai`-IDs; OpenCode `anbieter/modell`. */
export const MODELS_DEV_PROVIDERS = ["anthropic", "openai", "deepseek"] as const;
/** Anbieter, deren Modell-IDs zusätzlich ohne Anbieter-Präfix gelten (so heißen sie in Claude Code und Codex). */
const BARE_ID_PROVIDERS = new Set<string>(["anthropic", "openai"]);

/**
 * Claude Code schreibt Caches mit 1h-TTL (docs/research/kosten-claude-code.md): Cache-Write kostet dort das
 * Doppelte des Input-Tarifs statt des 5-min-Tarifs von models.dev. Gilt für die Anthropic-IDs ohne Präfix
 * (so heißen die Modelle in Claude Code); `anthropic/…` (OpenCode) behält den Tarif von models.dev.
 */
const CLAUDE_CODE_CACHE_WRITE_FACTOR = 2;

/** Vorbefüllte Websuchpreise je Harness in USD pro Suche (Claude Code: $10 pro 1.000 Suchen). */
const WEB_SEARCH_PER_SEARCH: Partial<Record<Harness, number>> = { claude_code: 0.01 };

/** Aktueller Auszug im Repo. */
export const MODELS_DEV_SNAPSHOT_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "data",
  "pricing",
  "models-dev-2026-10-24.json",
);

const costSchema = z
  .object({
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    cache_read: z.number().nonnegative().optional(),
    cache_write: z.number().nonnegative().optional(),
  })
  .loose();

export const modelsDevSnapshotSchema = z.object({
  format: z.literal(MODELS_DEV_FORMAT),
  source: z.string(),
  /** Abrufdatum `YYYY-MM-DD`; zugleich Gültig-ab-Datum der Preise. */
  retrievedAt: z.iso.date(),
  providers: z.record(
    z.string(),
    z.record(z.string(), z.object({ name: z.string(), cost: costSchema.nullable() })),
  ),
});
export type ModelsDevSnapshot = z.infer<typeof modelsDevSnapshotSchema>;

export async function readModelsDevSnapshot(
  file: string = MODELS_DEV_SNAPSHOT_PATH,
): Promise<ModelsDevSnapshot> {
  return modelsDevSnapshotSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

/**
 * Preise des Auszugs je Modell-ID, gültig ab dem Abrufdatum. Jedes Modell erscheint als `anbieter/modell`
 * (OpenCode), Modelle von Anthropic und OpenAI zusätzlich ohne Präfix. Modelle ohne Input- oder
 * Output-Preis fehlen. Kontextstufen (`tiers`) bleiben unberücksichtigt: es gilt der Grundtarif. Für die
 * Anthropic-IDs ohne Präfix (Claude Code) gilt Cache-Write = 2× Input (`CLAUDE_CODE_CACHE_WRITE_FACTOR`).
 */
export function pricesFromModelsDev(snapshot: ModelsDevSnapshot): { modelId: string; price: ModelPrice }[] {
  const prices: { modelId: string; price: ModelPrice }[] = [];
  for (const [provider, providerModels] of Object.entries(snapshot.providers)) {
    for (const [id, model] of Object.entries(providerModels)) {
      const cost = model.cost;
      if (cost?.input === undefined || cost.output === undefined) continue;
      const price: ModelPrice = {
        validFrom: snapshot.retrievedAt,
        input: cost.input,
        cacheRead: cost.cache_read ?? null,
        cacheWrite: cost.cache_write ?? null,
        output: cost.output,
      };
      prices.push({ modelId: `${provider}/${id}`, price });
      if (!BARE_ID_PROVIDERS.has(provider)) continue;
      const bare =
        provider === "anthropic"
          ? { ...price, cacheWrite: price.input * CLAUDE_CODE_CACHE_WRITE_FACTOR }
          : price;
      prices.push({ modelId: id, price: bare });
    }
  }
  return prices.sort((a, b) => (a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0));
}

/** Websuchpreise, die mit dem Auszug vorbefüllt werden (gültig ab dem Abrufdatum). */
export function webSearchPricesFromModelsDev(
  snapshot: ModelsDevSnapshot,
): { harness: Harness; price: WebSearchPrice }[] {
  return Object.entries(WEB_SEARCH_PER_SEARCH).map(([harness, perSearch]) => ({
    harness: harness as Harness,
    price: { validFrom: snapshot.retrievedAt, perSearch: perSearch as number },
  }));
}

/** Baut den Auszug aus dem vollständigen models.dev-Katalog (Ergebnis von `MODELS_DEV_URL`). */
export function extractModelsDevSnapshot(catalog: unknown, retrievedAt: string): ModelsDevSnapshot {
  const parsed = z
    .record(
      z.string(),
      z.object({ models: z.record(z.string(), z.object({ name: z.string() }).loose()) }).loose(),
    )
    .parse(catalog);
  const providers: ModelsDevSnapshot["providers"] = {};
  for (const provider of MODELS_DEV_PROVIDERS) {
    const entry = parsed[provider];
    if (!entry) throw new Error(`Anbieter ${provider} fehlt im models.dev-Katalog`);
    providers[provider] = Object.fromEntries(
      Object.keys(entry.models)
        .sort()
        .map((id) => {
          const model = entry.models[id];
          const cost = costSchema.safeParse(model.cost);
          return [id, { name: model.name, cost: cost.success ? cost.data : null }];
        }),
    );
  }
  return modelsDevSnapshotSchema.parse({
    format: MODELS_DEV_FORMAT,
    source: MODELS_DEV_URL,
    retrievedAt,
    providers,
  });
}
