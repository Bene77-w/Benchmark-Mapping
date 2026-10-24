"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { webSearchPriceInputSchema } from "@/server/pricing/model";
import { saveModelPrice, saveWebSearchPrice } from "@/server/pricing/store";

export interface SavePriceState {
  error: string | null;
  saved: string | null;
}

/** Leeres Feld → `null` (kein Tarif), sonst Zahl (Komma oder Punkt). */
const optionalNumber = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value.replace(",", "."))));
const requiredNumber = z
  .string()
  .trim()
  .min(1, "Preis fehlt")
  .transform((value) => Number(value.replace(",", ".")));

const modelPriceForm = z.object({
  modelId: z.string(),
  validFrom: z.string(),
  input: requiredNumber,
  cacheRead: optionalNumber,
  cacheWrite: optionalNumber,
  output: requiredNumber,
});

const webSearchPriceForm = z.object({
  harness: webSearchPriceInputSchema.shape.harness,
  validFrom: z.string(),
  perSearch: requiredNumber,
});

/** Legt einen Modellpreis an oder ändert ihn (gleiches Modell und Gültig-ab-Datum). */
export async function saveModelPriceAction(
  _previous: SavePriceState,
  formData: FormData,
): Promise<SavePriceState> {
  try {
    const form = modelPriceForm.parse(Object.fromEntries(formData));
    await saveModelPrice(getDatabase(), form);
    revalidatePath("/", "layout");
    return { error: null, saved: `Preis für ${form.modelId.trim()} ab ${form.validFrom} gespeichert.` };
  } catch (error) {
    return { error: describe(error), saved: null };
  }
}

/** Legt einen Websuchpreis an oder ändert ihn (gleicher Harness und Gültig-ab-Datum). */
export async function saveWebSearchPriceAction(
  _previous: SavePriceState,
  formData: FormData,
): Promise<SavePriceState> {
  try {
    const form = webSearchPriceForm.parse(Object.fromEntries(formData));
    await saveWebSearchPrice(getDatabase(), form);
    revalidatePath("/", "layout");
    return { error: null, saved: `Websuchpreis ab ${form.validFrom} gespeichert.` };
  } catch (error) {
    return { error: describe(error), saved: null };
  }
}

function describe(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
