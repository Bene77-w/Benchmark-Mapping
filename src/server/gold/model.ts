import { z } from "zod";
import type { HarnessErrorKind } from "@/server/harness/adapter";
import type { UnitAnswer } from "@/server/prompt/output-schema";
import type { ConfigurationView, UnitResultStatus } from "@/server/runs/model";
import type { GoldVersion } from "@/server/scoring/model";
import type { SnapshotUnit } from "@/server/snapshot/model";

/**
 * Gold-Set und Gold-Versionen (Begriffe in GLOSSARY.md). Es gibt höchstens einen Entwurf (`draft`), den die
 * Gold-Review bearbeitet; der Abschluss friert ihn als nummerierte Gold-Version (`gold-v1`, …) ein.
 */

export const MAX_GOLD_UNITS = 30;
export const MAX_VERTRETBAR_PER_UNIT = 2;

/** Kategorie einer Gold-Unit: Art der Schwierigkeit, für die sie steht. */
export const GOLD_CATEGORIES = ["a", "b", "c", "d", "e", "f"] as const;
export type GoldCategory = (typeof GOLD_CATEGORIES)[number];
export const GOLD_CATEGORY_LABELS: Record<GoldCategory, string> = {
  a: "a – breit",
  b: "b – eng",
  c: "c – no_mapping",
  d: "d – Committee-Kern/direkt",
  e: "e – name_only",
  f: "f – schwierige Zuordnung",
};

/** Gold-Klasse einer Industry. */
export const GOLD_CLASSES = ["positiv", "vertretbar"] as const;
export type GoldClass = (typeof GOLD_CLASSES)[number];

export const GOLD_VERSION_STATUSES = ["draft", "frozen"] as const;
export type GoldVersionStatus = (typeof GOLD_VERSION_STATUSES)[number];

export const goldIndustrySchema = z.object({
  industryId: z.string().min(1),
  class: z.enum(GOLD_CLASSES),
  webOnly: z.boolean(),
});
export type GoldIndustry = z.infer<typeof goldIndustrySchema>;

/** Entscheidung der Gold-Review für eine Unit; ersetzt die bisherige vollständig. */
export const goldUnitDecisionSchema = z.object({
  category: z.enum(GOLD_CATEGORIES),
  noMapping: z.boolean(),
  note: z.string().trim().nullable(),
  industries: z
    .array(goldIndustrySchema)
    .refine(
      (industries) => new Set(industries.map((industry) => industry.industryId)).size === industries.length,
      "Industry doppelt angegeben",
    ),
});
export type GoldUnitDecision = z.input<typeof goldUnitDecisionSchema>;

export interface GoldUnit {
  unitId: string;
  category: GoldCategory;
  noMapping: boolean;
  note: string | null;
  /** Sortiert nach industry_id. */
  industries: GoldIndustry[];
}

export interface GoldVersionView {
  id: number;
  /** `gold-vN`; beim Entwurf `null`. */
  label: string | null;
  status: GoldVersionStatus;
  snapshotId: number;
  snapshotHash: string;
  /** Label der Gold-Version, die der Entwurf als Ausgangspunkt übernommen hat; sonst `null`. */
  baseLabel: string | null;
  createdAt: Date;
  frozenAt: Date | null;
  /** Sortiert nach unit_id. */
  units: GoldUnit[];
}

/** Eingefrorene Gold-Version in der Form der Bewertung (Label als Version). */
export function toScoringGold(view: GoldVersionView): GoldVersion {
  if (view.status !== "frozen" || !view.label)
    throw new Error("Nur eingefrorene Gold-Versionen sind bewertbar");
  return { version: view.label, units: view.units };
}

export const GOLD_ISSUE_KINDS = [
  "no_units",
  "too_many_units",
  "missing_decision",
  "no_positive",
  "too_many_vertretbar",
  "no_mapping_with_industries",
  "unknown_industry",
  "unchanged",
] as const;
export type GoldIssueKind = (typeof GOLD_ISSUE_KINDS)[number];

/** Befund der Prüfung vor dem Abschluss; jeder Befund blockiert den Abschluss. */
export interface GoldIssue {
  kind: GoldIssueKind;
  /** Betroffene Unit; `null` bei Befunden zum ganzen Gold-Set. */
  unitId: string | null;
  message: string;
}

/** Prüft ein Gold-Set vor dem Abschluss: Vollständigkeit und Klassenregeln. */
export function validateGold(units: GoldUnit[], industryIds: ReadonlySet<string>): GoldIssue[] {
  const issues: GoldIssue[] = [];
  if (units.length === 0) issues.push({ kind: "no_units", unitId: null, message: "Keine Unit ausgewählt" });
  if (units.length > MAX_GOLD_UNITS) {
    issues.push({
      kind: "too_many_units",
      unitId: null,
      message: `${units.length} Units ausgewählt, höchstens ${MAX_GOLD_UNITS} erlaubt`,
    });
  }
  for (const unit of units) {
    const issue = (kind: GoldIssueKind, message: string) =>
      issues.push({ kind, unitId: unit.unitId, message });
    const vertretbar = unit.industries.filter((industry) => industry.class === "vertretbar").length;
    const positiv = unit.industries.length - vertretbar;
    if (unit.noMapping && unit.industries.length > 0) {
      issue("no_mapping_with_industries", "no_mapping zusammen mit Industries");
    } else if (!unit.noMapping && unit.industries.length === 0) {
      issue("missing_decision", "Weder Industries noch no_mapping entschieden");
    } else if (!unit.noMapping && positiv === 0) {
      issue("no_positive", "Keine positive Industry (nur vertretbare)");
    }
    if (vertretbar > MAX_VERTRETBAR_PER_UNIT) {
      issue(
        "too_many_vertretbar",
        `${vertretbar} vertretbare Industries, höchstens ${MAX_VERTRETBAR_PER_UNIT}`,
      );
    }
    for (const industry of unit.industries) {
      if (!industryIds.has(industry.industryId)) {
        issue("unknown_industry", `Industry ${industry.industryId} gibt es in der Taxonomie nicht`);
      }
    }
  }
  return issues;
}

/** Abschluss nicht möglich: die Befunde der Prüfung. */
export class GoldValidationError extends Error {
  constructor(readonly issues: GoldIssue[]) {
    super(`Gold-Review nicht abschließbar: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "GoldValidationError";
  }
}

/** Ein Vorschlag: die Antwort (oder der Fehler) eines Vorschlagslaufs für eine Unit. */
export interface GoldProposal {
  runId: number;
  configuration: ConfigurationView;
  status: UnitResultStatus;
  answer: UnitAnswer | null;
  error: { kind: HarnessErrorKind; message: string | null } | null;
}

/** Eine Industry in der Review: von Vorschlägen genannt und/oder im Gold. */
export interface GoldReviewIndustry {
  industryId: string;
  /** `null`, wenn die industry_id in der Taxonomie nicht vorkommt. */
  industryName: string | null;
  sectorName: string | null;
  description: string | null;
  /** Vorschlagsläufe, deren Antwort die Industry nennt (in der Reihenfolge der Vorschläge). */
  proposedBy: number[];
  /** Alle Vorschläge mit Antwort nennen sie; sonst ist sie ein Unterschied. */
  unanimous: boolean;
  gold: GoldIndustry | null;
}

/** Alles, was die Gold-Review für eine Unit des Entwurfs braucht. */
export interface GoldUnitReview {
  unit: SnapshotUnit;
  gold: GoldUnit;
  /** Vorschläge der Vorschlagsläufe des Entwurfs, ältester zuerst. */
  proposals: GoldProposal[];
  /** Sortiert nach industry_id. */
  industries: GoldReviewIndustry[];
  /** Die Vorschläge mit Antwort sind sich bei mapped/no_mapping nicht einig. */
  decisionsDiffer: boolean;
}
