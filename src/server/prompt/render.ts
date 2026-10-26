import { z } from "zod";
import type { Industry, SnapshotUnit } from "@/server/snapshot/model";

/**
 * Rendern des User-Prompts wie im Submapper (`build_user_prompt`, `render_unit`, `render_taxonomy`,
 * `untrusted_block`). Ergänzt: bei `committee_parent_core` die Liste der Subcommittees als Kontext.
 *
 * Alle festen Texte stehen in der Vorlage `data/prompts/<version>/user-prompt.json` (Teil des Benchmark-Prompts
 * und seines Hashes); hier steht nur, welche Bausteine in welcher Reihenfolge und unter welcher Bedingung
 * erscheinen. Neue Texte gehören in die Vorlage, nicht in diesen Code.
 */

export interface TaxonomyInfo {
  snapshotId: string;
  industries: readonly Industry[];
}

const LABEL_PATTERN = /^[A-Z0-9_-]{1,40}$/;
const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

/** Zulässige Platzhalter je Baustein der Vorlage; ein anderer Platzhalter macht die Vorlage ungültig. */
const PLACEHOLDERS = {
  prompt: ["unitId", "industryCount", "taxonomySnapshotId", "taxonomyBlock", "unitBlock"],
  start: ["label"],
  end: ["label"],
  defusedLine: ["line"],
  industry: ["industryId", "industryName", "sectorName", "description"],
  unit: ["unitId", "kind", "chamber", "committeeName", "unitName"],
  parentCommittee: ["parentCommitteeName"],
  jurisdictionText: ["jurisdictionText"],
  noJurisdictionText: [],
  parentContext: ["parentContextText"],
  subcommittees: ["subcommitteeNames"],
} as const;

function fragment(name: keyof typeof PLACEHOLDERS) {
  const allowed: readonly string[] = PLACEHOLDERS[name];
  return z.string().superRefine((text, context) => {
    for (const [, placeholder] of text.matchAll(PLACEHOLDER)) {
      if (!allowed.includes(placeholder)) {
        context.addIssue({
          code: "custom",
          message: `Unbekannter Platzhalter {${placeholder}} (zulässig: ${allowed.join(", ") || "keine"})`,
        });
      }
    }
  });
}

/** Mehrzeiliger Baustein: Zeilen der Vorlage, verbunden mit Zeilenumbruch. */
function lines(name: keyof typeof PLACEHOLDERS) {
  return z.array(fragment(name)).min(1);
}

export const userPromptTemplateSchema = z.strictObject({
  prompt: lines("prompt"),
  dataBlock: z.strictObject({
    start: fragment("start"),
    end: fragment("end"),
    defusedLine: fragment("defusedLine"),
  }),
  taxonomyLabel: z.string().regex(LABEL_PATTERN),
  unitLabel: z.string().regex(LABEL_PATTERN),
  industry: fragment("industry"),
  unit: lines("unit"),
  parentCommittee: fragment("parentCommittee"),
  jurisdictionText: fragment("jurisdictionText"),
  noJurisdictionText: fragment("noJurisdictionText"),
  parentContext: fragment("parentContext"),
  subcommittees: fragment("subcommittees"),
  subcommitteeSeparator: z.string(),
});
export type UserPromptTemplate = z.infer<typeof userPromptTemplateSchema>;

/** Setzt Werte in einen Baustein ein; eingesetzte Werte werden nicht erneut ersetzt. */
function fill(text: string | readonly string[], values: Record<string, string | number>): string {
  const joined = typeof text === "string" ? text : text.join("\n");
  return joined.replace(PLACEHOLDER, (_match, name: string) => String(values[name]));
}

/** Rahmt Fremdtext als Datenblock; Zeilen, die wie Rahmenzeilen aussehen, werden entschärft. */
export function untrustedBlock(template: UserPromptTemplate, label: string, text: string): string {
  const safeLines = text
    .split(/\r\n|\r|\n/)
    .map((line) => (line.trim().startsWith("<<<") ? fill(template.dataBlock.defusedLine, { line }) : line));
  return [
    fill(template.dataBlock.start, { label }),
    ...safeLines,
    fill(template.dataBlock.end, { label }),
  ].join("\n");
}

export function renderTaxonomy(template: UserPromptTemplate, industries: readonly Industry[]): string {
  return industries
    .map((industry) =>
      fill(template.industry, {
        industryId: industry.industryId,
        industryName: industry.industryName,
        sectorName: industry.sectorName,
        description: industry.description,
      }),
    )
    .join("\n");
}

/**
 * Eine Unit als Datenabschnitt. Der Parent-Kontext und die Subcommittees erscheinen nur als Kontext;
 * name_only bekommt keinen Zuständigkeitstext, weil dort ausschließlich der Name der Unit belegen darf.
 */
export function renderUnit(
  template: UserPromptTemplate,
  unit: SnapshotUnit,
  subcommittees: readonly SnapshotUnit[],
): string {
  const lines = [
    fill(template.unit, {
      unitId: unit.unitId,
      kind: unit.kind,
      chamber: unit.chamber,
      committeeName: unit.committeeName,
      unitName: unit.unitName,
    }),
  ];
  if (unit.parentCommitteeName) {
    lines.push(fill(template.parentCommittee, { parentCommitteeName: unit.parentCommitteeName }));
  }
  if (unit.inputBasis === "name_only" || unit.jurisdictionText === null) {
    lines.push(fill(template.noJurisdictionText, {}));
  } else {
    lines.push(fill(template.jurisdictionText, { jurisdictionText: unit.jurisdictionText }));
  }
  if (unit.parentContextText) {
    lines.push(fill(template.parentContext, { parentContextText: unit.parentContextText }));
  }
  if (unit.kind === "committee_parent_core" && subcommittees.length > 0) {
    const subcommitteeNames = subcommittees
      .map((subcommittee) => subcommittee.unitName)
      .join(template.subcommitteeSeparator);
    lines.push(fill(template.subcommittees, { subcommitteeNames }));
  }
  return lines.join("\n");
}

export function renderUserPrompt(
  template: UserPromptTemplate,
  unit: SnapshotUnit,
  subcommittees: readonly SnapshotUnit[],
  taxonomy: TaxonomyInfo,
): string {
  return fill(template.prompt, {
    unitId: unit.unitId,
    industryCount: taxonomy.industries.length,
    taxonomySnapshotId: taxonomy.snapshotId,
    taxonomyBlock: untrustedBlock(
      template,
      template.taxonomyLabel,
      renderTaxonomy(template, taxonomy.industries),
    ),
    unitBlock: untrustedBlock(template, template.unitLabel, renderUnit(template, unit, subcommittees)),
  });
}
