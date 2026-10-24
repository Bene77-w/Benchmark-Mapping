"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { GOLD_CATEGORIES, GOLD_CLASSES, GoldValidationError } from "@/server/gold/model";
import {
  addGoldUnit,
  adoptRecommendedCandidates,
  discardGoldDraft,
  finalizeGoldDraft,
  removeGoldUnit,
  saveGoldUnitDecision,
  startProposalRun,
} from "@/server/gold/store";
import { configurationSchema, MAX_PARALLELISM, MIN_PARALLELISM } from "@/server/runs/model";

export interface ActionState {
  error: string | null;
  message?: string | null;
}

/** Führt eine Änderung aus; Fehler erscheinen am Formular statt als Fehlerseite. */
async function attempt(work: () => Promise<string | undefined>): Promise<ActionState> {
  try {
    const message = await work();
    revalidatePath("/gold", "layout");
    return { error: null, message: message ?? null };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function addUnitAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { unitId, category } = z
      .object({ unitId: z.string().trim().min(1, "Unit fehlt"), category: z.enum(GOLD_CATEGORIES) })
      .parse(Object.fromEntries(formData));
    await addGoldUnit(getDatabase(), { unitId, category });
    return `${unitId} hinzugefügt`;
  });
}

export async function adoptRecommendationAction(_previous: ActionState): Promise<ActionState> {
  return attempt(async () => {
    const { added, skipped } = await adoptRecommendedCandidates(getDatabase());
    return `${added} Units übernommen${skipped.length > 0 ? `, ${skipped.length} wegen der Höchstzahl nicht` : ""}`;
  });
}

export async function removeUnitAction(formData: FormData): Promise<void> {
  await removeGoldUnit(getDatabase(), z.string().parse(formData.get("unitId")));
  revalidatePath("/gold", "layout");
}

export async function discardDraftAction(): Promise<void> {
  await discardGoldDraft(getDatabase());
  revalidatePath("/gold", "layout");
}

const proposalFormSchema = z.object({
  harness: z.string(),
  model: z.string(),
  effort: z.string(),
  parallelism: z.coerce.number().int().min(MIN_PARALLELISM).max(MAX_PARALLELISM),
  timeoutMinutes: z.coerce.number().positive(),
});

export async function startProposalRunAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return attempt(async () => {
    const form = proposalFormSchema.parse(Object.fromEntries(formData));
    const { mode: _mode, ...configuration } = configurationSchema.parse({ ...form, mode: "web" });
    const { runId } = await startProposalRun(getDatabase(), {
      configuration,
      parallelism: form.parallelism,
      timeoutMs: Math.round(form.timeoutMinutes * 60_000),
    });
    return `Vorschlagslauf #${runId} angelegt`;
  });
}

/**
 * Speichert die Entscheidung der Review für eine Unit. Formularfelder: `category`, `noMapping`, `note`, je
 * Industry `industry` (wiederholt) mit `class:<id>` (leer = nicht im Gold) und `webOnly:<id>`, dazu optional
 * eine neue Industry (`newIndustry`, `newClass`, `newWebOnly`).
 */
export async function saveDecisionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return attempt(async () => {
    const unitId = z.string().parse(formData.get("unitId"));
    const classSchema = z.enum(GOLD_CLASSES);
    const industries = formData
      .getAll("industry")
      .map(String)
      .filter((industryId) => formData.get(`class:${industryId}`))
      .map((industryId) => ({
        industryId,
        class: classSchema.parse(formData.get(`class:${industryId}`)),
        webOnly: formData.get(`webOnly:${industryId}`) === "on",
      }));
    const newIndustry = String(formData.get("newIndustry") ?? "").trim();
    if (newIndustry) {
      if (industries.some((industry) => industry.industryId === newIndustry)) {
        throw new Error(`Industry ${newIndustry} ist bereits im Gold`);
      }
      industries.push({
        industryId: newIndustry,
        class: classSchema.parse(formData.get("newClass")),
        webOnly: formData.get("newWebOnly") === "on",
      });
    }
    await saveGoldUnitDecision(getDatabase(), unitId, {
      category: z.enum(GOLD_CATEGORIES).parse(formData.get("category")),
      noMapping: formData.get("noMapping") === "on",
      note: String(formData.get("note") ?? "").trim() || null,
      industries,
    });
    return "Gespeichert";
  });
}

export async function finalizeAction(_previous: ActionState): Promise<ActionState> {
  let label: string;
  try {
    ({ label } = await finalizeGoldDraft(getDatabase()));
  } catch (error) {
    return { error: describe(error) };
  }
  revalidatePath("/gold", "layout");
  redirect(`/gold/versionen/${label}`);
}

function describe(error: unknown): string {
  if (error instanceof GoldValidationError) {
    return `Abschluss nicht möglich: ${error.issues.length} offene Befunde`;
  }
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
