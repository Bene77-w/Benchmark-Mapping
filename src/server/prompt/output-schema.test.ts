import { describe, expect, test } from "vitest";
import { OUTPUT_SCHEMA_VERSION, outputJsonSchema, unitAnswerSchema } from "./output-schema";

const mapped = {
  unit_id: "house--energy-and-commerce--health",
  decision: "mapped",
  no_mapping_reason: null,
  broad_scope_exception: false,
  broad_scope_reason: null,
  assignments: [
    {
      industry_id: "drug-manufacturers-general",
      evidence_excerpt: "Public health and quarantine.",
      rationale_short: "Die Regulierung der öffentlichen Gesundheit trifft Arzneimittelhersteller direkt.",
    },
  ],
  sources: [],
  label_uncertain: false,
  uncertainty_note: null,
};

describe("Ausgabeschema", () => {
  test("nimmt eine vollständige Antwort pro Unit an, mit null für nicht zutreffende Felder", () => {
    expect(unitAnswerSchema.parse(mapped)).toEqual(mapped);
    const noMapping = {
      ...mapped,
      decision: "no_mapping",
      no_mapping_reason: "Keine Industry erfüllt die Zuordnungsregel.",
      assignments: [],
      sources: [{ url: "https://example.org/hearing", belegt: "Anhörung zur Arzneimittelzulassung 2025" }],
      label_uncertain: true,
      uncertainty_note: "Zwei Industries passen gleich gut.",
    };
    expect(unitAnswerSchema.parse(noMapping)).toEqual(noMapping);
  });

  test("ist strikt: fehlende Felder, Zusatzfelder und confidence sind Schemaverstöße", () => {
    const { uncertainty_note: _omitted, ...missing } = mapped;
    expect(unitAnswerSchema.safeParse(missing).success).toBe(false);
    expect(unitAnswerSchema.safeParse({ ...mapped, requested_batch_id: "b1" }).success).toBe(false);
    const withConfidence = { ...mapped, assignments: [{ ...mapped.assignments[0], confidence: 3 }] };
    expect(unitAnswerSchema.safeParse(withConfidence).success).toBe(false);
    expect(unitAnswerSchema.safeParse({ ...mapped, decision: "unclear" }).success).toBe(false);
    expect(unitAnswerSchema.safeParse({ ...mapped, sources: [{ url: "https://example.org" }] }).success).toBe(
      false,
    );
  });

  test("Regelverstöße sind keine Schemaverstöße (z. B. sechs Zuordnungen bei no_mapping)", () => {
    const answer = { ...mapped, decision: "no_mapping", assignments: Array(6).fill(mapped.assignments[0]) };
    expect(unitAnswerSchema.safeParse(answer).success).toBe(true);
  });

  test("liegt als striktes JSON-Schema wie im Submapper vor (ohne confidence)", () => {
    expect(OUTPUT_SCHEMA_VERSION).toBe("unit-answer-v1");
    expect(outputJsonSchema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        unit_id: { type: "string" },
        decision: { type: "string", enum: ["mapped", "no_mapping"] },
        no_mapping_reason: { type: ["string", "null"] },
        broad_scope_exception: { type: "boolean" },
        broad_scope_reason: { type: ["string", "null"] },
        assignments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              industry_id: {
                type: "string",
                description: "Exakte industry_id aus der uebergebenen Taxonomie.",
              },
              evidence_excerpt: {
                type: "string",
                description:
                  "Woertlicher Ausschnitt aus Name oder Zustaendigkeitstext; exakt 'Recherche' nur bei rein recherchegestuetzter Zuordnung im Modus mit Websuche.",
              },
              rationale_short: {
                type: "string",
                description: "Ein bis zwei Saetze, die Evidence und Kerngeschaeft verbinden.",
              },
            },
            required: ["industry_id", "evidence_excerpt", "rationale_short"],
          },
        },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              url: { type: "string" },
              belegt: { type: "string", description: "Was diese Quelle belegt, in einem Halbsatz." },
            },
            required: ["url", "belegt"],
          },
        },
        label_uncertain: { type: "boolean" },
        uncertainty_note: { type: ["string", "null"] },
      },
      required: [
        "unit_id",
        "decision",
        "no_mapping_reason",
        "broad_scope_exception",
        "broad_scope_reason",
        "assignments",
        "sources",
        "label_uncertain",
        "uncertainty_note",
      ],
    });
  });
});
