import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashCanonical } from "@/server/snapshot/hash";
import type { Snapshot, SnapshotUnit } from "@/server/snapshot/model";
import { type JsonSchema, OUTPUT_SCHEMA_VERSION, outputJsonSchema } from "./output-schema";
import { renderUserPrompt, type TaxonomyInfo, userPromptTemplateSchema } from "./render";

/**
 * Benchmark-Prompt: der versionierte Modellvertrag samt Brief, den jedes Modell eines Laufs unverändert
 * erhält. Die Texte liegen unter `data/prompts/<version>/`: Vertrag, Briefs und die Vorlage des User-Prompts
 * (`user-prompt.json`). System-Prompt = Vertrag + Brief; der User-Prompt rendert Taxonomie und Unit des
 * Snapshots nach der Vorlage.
 */
export const PROMPT_VERSION = "prompt-v1";
export const PROMPT_ROOT = "data/prompts";

/** Modus eines Laufs: nur Zuständigkeitstext oder zusätzlich Websuche. */
export const MODES = ["text_only", "web"] as const;
export type Mode = (typeof MODES)[number];
/** Art eines Laufs: Benchmark (Rangliste) oder Vorschlagslauf für die Gold-Review. */
export const RUN_KINDS = ["benchmark", "proposal"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export interface PromptRequest {
  runKind: RunKind;
  /** Vorschlagsläufe laufen immer mit Websuche. */
  mode: Mode;
}

/** Der Teil des Snapshots, den der Prompt braucht; die Reihenfolge der Listen ist egal. */
export type PromptSnapshot = Pick<Snapshot, "units" | "industries" | "source">;

export interface UnitPrompt {
  unitId: string;
  systemPrompt: string;
  userPrompt: string;
  /** SHA-256 über den exakt gesendeten Text dieser Unit: System-Prompt, User-Prompt und Ausgabeschema. */
  unitPromptHash: string;
}

export interface BenchmarkPrompt {
  version: string;
  request: PromptRequest;
  systemPrompt: string;
  outputSchema: JsonSchema;
  outputSchemaVersion: string;
  /** SHA-256 über das kanonische Ausgabeschema. */
  outputSchemaHash: string;
  /**
   * Benchmark-Prompt-Hash des Laufs: SHA-256 über die festen Anweisungstexte – Version, System-Prompt
   * (Vertrag + Brief bzw. Gold-Brief), Vorlage des User-Prompts und Ausgabeschema. Jede Textänderung daran
   * ändert ihn; die Daten (Units, Taxonomie) deckt der Snapshot-Hash ab. Gleicher Prompt-Hash und gleicher
   * Snapshot-Hash ⇔ gleiche gesendete Texte.
   */
  promptHash: string;
  /** Prompt für eine Unit des Snapshots; eine unbekannte unit_id ist ein Fehler. */
  forUnit(unitId: string): UnitPrompt;
}

export interface PromptOptions {
  /** Wurzel der Prompt-Dateien, Standard `data/prompts`. */
  promptRoot?: string;
  version?: string;
}

/** Vorlage, nach der Taxonomie und Unit in den User-Prompt gerendert werden. */
const USER_PROMPT_TEMPLATE_FILE = "user-prompt.json";

const BRIEF_FILE: Record<`${RunKind}/${Mode}`, string | null> = {
  "benchmark/text_only": "brief-text-only.md",
  "benchmark/web": "brief-web.md",
  "proposal/web": "brief-gold.md",
  "proposal/text_only": null,
};

export async function buildBenchmarkPrompt(
  snapshot: PromptSnapshot,
  request: PromptRequest,
  options: PromptOptions = {},
): Promise<BenchmarkPrompt> {
  const version = options.version ?? PROMPT_VERSION;
  // Die Prompt-Dateien werden zur Laufzeit gelesen (lokale App); turbopackIgnore verhindert, dass der Build
  // deshalb das ganze Projekt in die Server-Ausgabe aufnimmt.
  const directory = path.join(/*turbopackIgnore: true*/ options.promptRoot ?? PROMPT_ROOT, version);
  const briefFile = BRIEF_FILE[`${request.runKind}/${request.mode}`];
  if (briefFile === null) throw new Error("Vorschlagsläufe laufen immer im Modus mit Websuche");
  const [contract, brief, templateText] = await Promise.all(
    ["contract.md", briefFile, USER_PROMPT_TEMPLATE_FILE].map((file) =>
      readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ directory, file), "utf8"),
    ),
  );
  const systemPrompt = [contract.trim(), brief.trim()].join("\n\n");
  const template = userPromptTemplateSchema.parse(JSON.parse(templateText));

  const units = [...snapshot.units].sort((a, b) => compare(a.unitId, b.unitId));
  const taxonomy: TaxonomyInfo = {
    snapshotId: snapshot.source.taxonomySnapshotId,
    industries: [...snapshot.industries].sort((a, b) => compare(a.industryId, b.industryId)),
  };
  const unitById = new Map(units.map((unit) => [unit.unitId, unit]));
  const subcommitteesOf = Map.groupBy(
    units.filter((unit) => unit.parentUnitId !== null),
    (unit) => unit.parentUnitId as string,
  );
  const userPromptOf = (unit: SnapshotUnit) =>
    renderUserPrompt(template, unit, subcommitteesOf.get(unit.unitId) ?? [], taxonomy);

  return {
    version,
    request,
    systemPrompt,
    outputSchema: outputJsonSchema,
    outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
    outputSchemaHash: hashCanonical(outputJsonSchema),
    promptHash: hashCanonical({
      version,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      systemPrompt,
      userPromptTemplate: template,
      outputSchema: outputJsonSchema,
    }),
    forUnit(unitId) {
      const unit = unitById.get(unitId);
      if (!unit) throw new Error(`Unit ${unitId} gibt es im Snapshot nicht`);
      const userPrompt = userPromptOf(unit);
      return {
        unitId,
        systemPrompt,
        userPrompt,
        unitPromptHash: hashCanonical({ systemPrompt, userPrompt, outputSchema: outputJsonSchema }),
      };
    },
  };
}

/** Vergleich nach Codepunkten, unabhängig von Locale und Datenbank-Sortierung. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
