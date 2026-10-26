import { z } from "zod";

/**
 * Ausgabeschema: die Antwort eines Modells für genau eine Unit.
 *
 * Strikt wie im Submapper: jedes Feld ist required, Zusatzfelder sind unzulässig, nicht zutreffende Felder
 * sind `null` statt weggelassen. Das Schema prüft nur die Form; Regeln des Benchmark-Prompts (Anzahl,
 * wörtliche Evidence, `Recherche` je Modus, Widerspruch decision/assignments, bekannte industry_id) prüft
 * die Bewertung als Regelverstöße. Dass `unit_id` die angefragte Unit ist, prüft `parseAnswerText`
 * (Harness-Adapter) als Schemaverstoß.
 */
export const OUTPUT_SCHEMA_VERSION = "unit-answer-v1";

export const assignmentSchema = z.strictObject({
  industry_id: z.string().describe("Exakte industry_id aus der uebergebenen Taxonomie."),
  evidence_excerpt: z
    .string()
    .describe(
      "Woertlicher Ausschnitt aus Name oder Zustaendigkeitstext; exakt 'Recherche' nur bei rein recherchegestuetzter Zuordnung im Modus mit Websuche.",
    ),
  rationale_short: z.string().describe("Ein bis zwei Saetze, die Evidence und Kerngeschaeft verbinden."),
});

export const sourceSchema = z.strictObject({
  url: z.string(),
  belegt: z.string().describe("Was diese Quelle belegt, in einem Halbsatz."),
});

export const unitAnswerSchema = z.strictObject({
  unit_id: z.string(),
  decision: z.enum(["mapped", "no_mapping"]),
  no_mapping_reason: z.string().nullable(),
  broad_scope_exception: z.boolean(),
  broad_scope_reason: z.string().nullable(),
  assignments: z.array(assignmentSchema),
  sources: z.array(sourceSchema),
  label_uncertain: z.boolean(),
  uncertainty_note: z.string().nullable(),
});

export type Assignment = z.infer<typeof assignmentSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type UnitAnswer = z.infer<typeof unitAnswerSchema>;
export type JsonSchema = Record<string, unknown>;

/**
 * Dasselbe Schema als JSON-Schema für die Harnesses (`--json-schema`, `--output-schema`, Prompt bei
 * OpenCode). Ohne `$schema`-Angabe, damit es unverändert an strikte Endpoints geht.
 */
export const outputJsonSchema: JsonSchema = (() => {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(unitAnswerSchema) as JsonSchema;
  return schema;
})();
