import { z } from "zod";
import { HARNESSES, type Harness } from "@/server/harness/adapter";

/** Eingaben und Ansichten der Preistabelle (Modelle und Preise pflegen). */

const usd = z.number({ error: "Preis fehlt" }).nonnegative("Preis darf nicht negativ sein");
const validFrom = z.iso.date("Gültig ab muss ein Datum JJJJ-MM-TT sein");

/** Preis eines Modells in USD pro Million Tokens; Cache-Tarife sind optional (`null` = unbekannt). */
export const modelPriceInputSchema = z.object({
  modelId: z.string().trim().min(1, "Modell-ID fehlt"),
  validFrom,
  input: usd,
  cacheRead: usd.nullable(),
  cacheWrite: usd.nullable(),
  output: usd,
});
export type ModelPriceInput = z.input<typeof modelPriceInputSchema>;

export const webSearchPriceInputSchema = z.object({
  harness: z.enum(HARNESSES),
  validFrom,
  perSearch: usd,
});
export type WebSearchPriceInput = z.input<typeof webSearchPriceInputSchema>;

/** Herkunft von Hand gepflegter Einträge und von Einträgen, die ein Lauf angelegt hat. */
export const MANUAL_SOURCE = "manuell";
export const RUN_SOURCE = "Lauf";

export interface ModelPriceView {
  validFrom: string;
  input: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number;
  source: string;
  updatedAt: Date;
}

export interface ModelView {
  id: string;
  source: string;
  createdAt: Date;
  /** Neuester Preis zuerst; leer = Modell ohne Preis. */
  prices: ModelPriceView[];
}

export interface WebSearchPriceView {
  harness: Harness;
  validFrom: string;
  perSearch: number;
  source: string;
  updatedAt: Date;
}
