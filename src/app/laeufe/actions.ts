"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { requireActiveGold } from "@/server/gold/active";
import { configurationSchema, MAX_PARALLELISM, MIN_PARALLELISM } from "@/server/runs/model";
import {
  cancelRun,
  createRun,
  createRunFromConfiguration,
  resumeRun,
  supplementRun,
} from "@/server/runs/store";

export interface StartRunState {
  error: string | null;
}

const formSchema = z.object({
  harness: z.string(),
  model: z.string(),
  effort: z.string(),
  mode: z.string(),
  parallelism: z.coerce.number().int().min(MIN_PARALLELISM).max(MAX_PARALLELISM),
  timeoutMinutes: z.coerce.number().positive(),
});

/** Legt einen Lauf über die Units der aktuellen Gold-Version an; der Worker führt ihn aus. */
export async function startRun(_previous: StartRunState, formData: FormData): Promise<StartRunState> {
  let runId: number;
  try {
    const form = formSchema.parse(Object.fromEntries(formData));
    const gold = await requireActiveGold(getDatabase());
    ({ runId } = await createRun(getDatabase(), {
      configuration: configurationSchema.parse(form),
      parallelism: form.parallelism,
      timeoutMs: Math.round(form.timeoutMinutes * 60_000),
      unitIds: gold.units.map((unit) => unit.unitId),
    }));
  } catch (error) {
    return { error: describe(error) };
  }
  redirect(`/laeufe/${runId}`);
}

/** Startet eine gespeicherte Konfiguration erneut. */
export async function restartConfiguration(formData: FormData): Promise<void> {
  const configurationId = z.coerce.number().int().parse(formData.get("configurationId"));
  const gold = await requireActiveGold(getDatabase());
  const { runId } = await createRunFromConfiguration(
    getDatabase(),
    configurationId,
    gold.units.map((unit) => unit.unitId),
  );
  redirect(`/laeufe/${runId}`);
}

/** Bricht einen Lauf ab; der Worker startet danach keine Units mehr. */
export async function cancelRunAction(formData: FormData): Promise<void> {
  const runId = z.coerce.number().int().parse(formData.get("runId"));
  await cancelRun(getDatabase(), runId);
  revalidatePath(`/laeufe/${runId}`);
}

/** Setzt einen abgebrochenen Lauf fort; nur offene Units werden noch aufgerufen. */
export async function resumeRunAction(formData: FormData): Promise<void> {
  const runId = z.coerce.number().int().parse(formData.get("runId"));
  await resumeRun(getDatabase(), runId);
  revalidatePath(`/laeufe/${runId}`);
}

/**
 * Ergänzt einen Lauf mit derselben Konfiguration um die Units der aktuellen Gold-Version, für die er kein
 * Ergebnis hat; der Worker ruft nur diese auf.
 */
export async function supplementRunAction(formData: FormData): Promise<void> {
  const runId = z.coerce.number().int().parse(formData.get("runId"));
  const gold = await requireActiveGold(getDatabase());
  await supplementRun(
    getDatabase(),
    runId,
    gold.units.map((unit) => unit.unitId),
  );
  revalidatePath(`/laeufe/${runId}`);
}

function describe(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
