import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import {
  configurations,
  goldIndustries,
  goldProposalRuns,
  goldUnits,
  goldVersions,
  industries,
  runs,
  unitResults,
  units,
} from "@/server/db/schema";
import type { Configuration, RunSummary } from "@/server/runs/model";
import { createRun, listRuns, type PromptRootOption } from "@/server/runs/store";
import { hashCanonical } from "@/server/snapshot/hash";
import { getCurrentSnapshot } from "@/server/snapshot/store";
import { readGoldCandidates } from "./candidates";
import {
  type GoldCategory,
  type GoldIssue,
  type GoldProposal,
  type GoldReviewIndustry,
  type GoldUnit,
  type GoldUnitDecision,
  type GoldUnitReview,
  GoldValidationError,
  type GoldVersionView,
  goldUnitDecisionSchema,
  MAX_GOLD_UNITS,
  validateGold,
} from "./model";

/**
 * Gold-Erstellung in der Datenbank. Alle Änderungen betreffen den einzigen Entwurf; eingefrorene
 * Gold-Versionen sind über diese Schnittstelle nicht änderbar. Der Entwurf entsteht mit der ersten Unit und
 * bezieht sich auf den aktuellen Snapshot.
 */

/** Der Entwurf samt Units oder `null`, wenn es keinen gibt. */
export async function getGoldDraft(db: Database): Promise<GoldVersionView | null> {
  const [draft] = await db.select().from(goldVersions).where(eq(goldVersions.status, "draft"));
  return draft ? withUnits(db, draft) : null;
}

/** Nimmt eine Unit des Snapshots mit Kategorie in den Entwurf auf (höchstens 30). */
export async function addGoldUnit(
  db: Database,
  { unitId, category }: { unitId: string; category: GoldCategory },
): Promise<void> {
  await db.transaction(async (tx) => {
    const draft = await ensureDraft(tx);
    const [known] = await tx
      .select({ unitId: units.unitId })
      .from(units)
      .where(and(eq(units.snapshotId, draft.snapshotId), eq(units.unitId, unitId)));
    if (!known) throw new Error(`Unit ${unitId} gibt es im Snapshot nicht`);
    const [{ value: selected }] = await tx
      .select({ value: count() })
      .from(goldUnits)
      .where(eq(goldUnits.goldVersionId, draft.id));
    const inserted = await tx
      .insert(goldUnits)
      .values({ goldVersionId: draft.id, unitId, category })
      .onConflictDoNothing()
      .returning({ unitId: goldUnits.unitId });
    if (inserted.length === 0) throw new Error(`Unit ${unitId} ist bereits im Gold-Set`);
    if (selected >= MAX_GOLD_UNITS) {
      throw new Error(`Das Gold-Set hat bereits ${MAX_GOLD_UNITS} Units (Höchstzahl)`);
    }
  });
}

/**
 * Übernimmt die empfohlene 30er-Auswahl der Kandidatenliste in den Entwurf: ergänzt fehlende Units mit ihrer
 * Kategorie, bis 30 erreicht sind; bereits gewählte Units bleiben unverändert.
 */
export async function adoptRecommendedCandidates(
  db: Database,
): Promise<{ added: number; skipped: string[] }> {
  const recommended = (await readGoldCandidates()).filter((candidate) => candidate.recommended);
  const selected = new Set((await getGoldDraft(db))?.units.map((unit) => unit.unitId) ?? []);
  const missing = recommended.filter((candidate) => !selected.has(candidate.unitId));
  const room = Math.max(0, MAX_GOLD_UNITS - selected.size);
  for (const candidate of missing.slice(0, room)) await addGoldUnit(db, candidate);
  return { added: Math.min(room, missing.length), skipped: missing.slice(room).map((c) => c.unitId) };
}

/** Verwirft den Entwurf samt Entscheidungen; Vorschlagsläufe bleiben als Läufe erhalten. */
export async function discardGoldDraft(db: Database): Promise<void> {
  await db.delete(goldVersions).where(eq(goldVersions.status, "draft"));
}

export async function setGoldUnitCategory(
  db: Database,
  unitId: string,
  category: GoldCategory,
): Promise<void> {
  const draft = await requireDraft(db);
  const updated = await db
    .update(goldUnits)
    .set({ category })
    .where(and(eq(goldUnits.goldVersionId, draft.id), eq(goldUnits.unitId, unitId)))
    .returning({ unitId: goldUnits.unitId });
  if (updated.length === 0) throw new Error(`Unit ${unitId} ist nicht im Gold-Set`);
}

export async function removeGoldUnit(db: Database, unitId: string): Promise<void> {
  const draft = await requireDraft(db);
  await db.delete(goldUnits).where(and(eq(goldUnits.goldVersionId, draft.id), eq(goldUnits.unitId, unitId)));
}

/** Speichert die Entscheidung der Gold-Review für eine Unit des Entwurfs (ersetzt die bisherige). */
export async function saveGoldUnitDecision(
  db: Database,
  unitId: string,
  decision: GoldUnitDecision,
): Promise<void> {
  const parsed = goldUnitDecisionSchema.parse(decision);
  const draft = await requireDraft(db);
  const known = await industryIdsOf(db, draft.snapshotId);
  const unknown = parsed.industries.filter((industry) => !known.has(industry.industryId));
  if (unknown.length > 0) {
    throw new Error(
      `Industries gibt es in der Taxonomie nicht: ${unknown.map((i) => i.industryId).join(", ")}`,
    );
  }
  await db.transaction(async (tx) => {
    const where = and(eq(goldUnits.goldVersionId, draft.id), eq(goldUnits.unitId, unitId));
    const updated = await tx
      .update(goldUnits)
      .set({ category: parsed.category, noMapping: parsed.noMapping, note: parsed.note || null })
      .where(where)
      .returning({ unitId: goldUnits.unitId });
    if (updated.length === 0) throw new Error(`Unit ${unitId} ist nicht im Gold-Set`);
    await tx
      .delete(goldIndustries)
      .where(and(eq(goldIndustries.goldVersionId, draft.id), eq(goldIndustries.unitId, unitId)));
    if (parsed.industries.length > 0) {
      await tx
        .insert(goldIndustries)
        .values(parsed.industries.map((industry) => ({ goldVersionId: draft.id, unitId, ...industry })));
    }
  });
}

/**
 * Übernimmt eine eingefrorene Gold-Version als Ausgangspunkt: der neue Entwurf enthält ihre Units samt
 * Kategorie, no_mapping, Notiz und Gold-Industries. Nur möglich, solange es keinen Entwurf gibt; der Entwurf
 * bezieht sich auf den aktuellen Snapshot, der alle Units der Version enthalten muss.
 */
export async function startGoldDraftFromVersion(db: Database, label: string): Promise<GoldVersionView> {
  const base = await getGoldVersion(db, label);
  if (!base) throw new Error(`Gold-Version ${label} gibt es nicht`);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: goldVersions.id }).from(goldVersions).where(isDraft);
    if (existing) throw new Error("Es gibt bereits einen Gold-Entwurf: zuerst abschließen oder verwerfen");
    const snapshot = await getCurrentSnapshot(tx);
    if (!snapshot) throw new Error("Kein Snapshot geladen");
    const known = new Set(
      (
        await tx.select({ unitId: units.unitId }).from(units).where(eq(units.snapshotId, snapshot.snapshotId))
      ).map((row) => row.unitId),
    );
    const unknown = base.units.filter((unit) => !known.has(unit.unitId));
    if (unknown.length > 0) {
      throw new Error(
        `Units von ${label} gibt es im aktuellen Snapshot nicht: ${unknown.map((u) => u.unitId).join(", ")}`,
      );
    }
    const [draft] = await tx
      .insert(goldVersions)
      .values({ snapshotId: snapshot.snapshotId, snapshotHash: snapshot.contentHash, baseVersionId: base.id })
      .returning({ id: goldVersions.id });
    if (base.units.length === 0) return;
    await tx.insert(goldUnits).values(
      base.units.map(({ unitId, category, noMapping, note }) => ({
        goldVersionId: draft.id,
        unitId,
        category,
        noMapping,
        note,
      })),
    );
    const baseIndustries = base.units.flatMap((unit) =>
      unit.industries.map((industry) => ({ goldVersionId: draft.id, unitId: unit.unitId, ...industry })),
    );
    if (baseIndustries.length > 0) await tx.insert(goldIndustries).values(baseIndustries);
  });
  const draft = await getGoldDraft(db);
  if (!draft) throw new Error("Gold-Entwurf fehlt");
  return draft;
}

/**
 * Prüft den Entwurf vor dem Abschluss; ohne Entwurf ist das Gold-Set leer. Ein Entwurf, der seinem
 * Ausgangspunkt gleicht, ergibt keine neue Gold-Version.
 */
export async function checkGoldDraft(db: Database): Promise<GoldIssue[]> {
  const draft = await getGoldDraft(db);
  if (!draft) return validateGold([], new Set());
  const issues = validateGold(draft.units, await industryIdsOf(db, draft.snapshotId));
  const base = draft.baseLabel ? await getGoldVersion(db, draft.baseLabel) : null;
  if (base && hashCanonical(base.units) === hashCanonical(draft.units)) {
    issues.push({
      kind: "unchanged",
      unitId: null,
      message: `Keine Änderung gegenüber ${base.label}: eine neue Gold-Version entsteht nur aus Änderungen`,
    });
  }
  return issues;
}

/**
 * Schließt die Gold-Review ab: friert den Entwurf als nächste Gold-Version (`gold-vN`) ein. Wirft
 * `GoldValidationError`, wenn die Prüfung Befunde hat.
 */
export async function finalizeGoldDraft(db: Database): Promise<{ id: number; label: string }> {
  const issues = await checkGoldDraft(db);
  if (issues.length > 0) throw new GoldValidationError(issues);
  return db.transaction(async (tx) => {
    const draft = await requireDraft(tx);
    const [{ value: frozen }] = await tx
      .select({ value: count() })
      .from(goldVersions)
      .where(eq(goldVersions.status, "frozen"));
    const label = `gold-v${frozen + 1}`;
    await tx
      .update(goldVersions)
      .set({ status: "frozen", label, frozenAt: new Date() })
      .where(eq(goldVersions.id, draft.id));
    return { id: draft.id, label };
  });
}

/** Eine eingefrorene Gold-Version über ihr Label (`gold-v1`, …). */
export async function getGoldVersion(db: Database, label: string): Promise<GoldVersionView | null> {
  const [row] = await db
    .select()
    .from(goldVersions)
    .where(and(eq(goldVersions.status, "frozen"), eq(goldVersions.label, label)));
  return row ? withUnits(db, row) : null;
}

/** Die neueste eingefrorene Gold-Version oder `null`. */
export async function getLatestGoldVersion(db: Database): Promise<GoldVersionView | null> {
  const [row] = await db
    .select()
    .from(goldVersions)
    .where(eq(goldVersions.status, "frozen"))
    .orderBy(desc(goldVersions.frozenAt), desc(goldVersions.id))
    .limit(1);
  return row ? withUnits(db, row) : null;
}

/** Eingefrorene Gold-Versionen ohne Units, neueste zuerst. */
export async function listGoldVersions(db: Database): Promise<Omit<GoldVersionView, "units">[]> {
  const rows = await db
    .select()
    .from(goldVersions)
    .where(eq(goldVersions.status, "frozen"))
    .orderBy(desc(goldVersions.frozenAt), desc(goldVersions.id));
  return toVersionSummaries(db, rows);
}

export interface ProposalRunRequest {
  /** Harness, Modell und Effort; der Modus ist bei Vorschlagsläufen immer „mit Websuche“. */
  configuration: Omit<Configuration, "mode">;
  parallelism?: number;
  timeoutMs?: number;
}

/**
 * Startet einen Vorschlagslauf (Lauf-Art `proposal`, Gold-Brief, mit Web) über alle Units des Entwurfs und
 * ordnet ihn dem Entwurf zu; der Worker führt ihn aus.
 */
export async function startProposalRun(
  db: Database,
  request: ProposalRunRequest,
  options: PromptRootOption = {},
): Promise<{ runId: number }> {
  const draft = await getGoldDraft(db);
  if (!draft || draft.units.length === 0) throw new Error("Der Gold-Entwurf hat noch keine Units");
  const { runId } = await createRun(
    db,
    {
      configuration: { ...request.configuration, mode: "web" },
      kind: "proposal",
      parallelism: request.parallelism,
      timeoutMs: request.timeoutMs,
      unitIds: draft.units.map((unit) => unit.unitId),
    },
    options,
  );
  await db.insert(goldProposalRuns).values({ goldVersionId: draft.id, runId });
  return { runId };
}

/** Vorschlagsläufe des Entwurfs, neueste zuerst. */
export async function getGoldProposalRuns(db: Database): Promise<RunSummary[]> {
  const draft = await getGoldDraft(db);
  if (!draft) return [];
  const runIds = new Set(await proposalRunIdsOf(db, draft.id));
  return (await listRuns(db)).filter((run) => runIds.has(run.id));
}

/** Review-Ansicht einer Unit des Entwurfs: Unit, Gold-Entscheidung, Vorschläge und ihre Unterschiede. */
export async function getGoldUnitReview(db: Database, unitId: string): Promise<GoldUnitReview | null> {
  const draft = await getGoldDraft(db);
  const gold = draft?.units.find((unit) => unit.unitId === unitId);
  if (!draft || !gold) return null;
  const [unitRow] = await db
    .select()
    .from(units)
    .where(and(eq(units.snapshotId, draft.snapshotId), eq(units.unitId, unitId)));
  const { snapshotId: _snapshotId, ...unit } = unitRow;

  const runIds = await proposalRunIdsOf(db, draft.id);
  const resultRows =
    runIds.length === 0
      ? []
      : await db
          .select({ result: unitResults, configuration: configurations })
          .from(unitResults)
          .innerJoin(runs, eq(unitResults.runId, runs.id))
          .innerJoin(configurations, eq(runs.configurationId, configurations.id))
          .where(and(inArray(unitResults.runId, runIds), eq(unitResults.unitId, unitId)))
          .orderBy(asc(unitResults.runId));
  const proposals = resultRows.map(
    ({ result, configuration }): GoldProposal => ({
      runId: result.runId,
      configuration: {
        id: configuration.id,
        harness: configuration.harness,
        model: configuration.model,
        effort: configuration.effort,
        mode: configuration.mode,
      },
      status: result.status,
      answer: result.answer,
      error: result.errorKind ? { kind: result.errorKind, message: result.errorMessage } : null,
    }),
  );

  const answered = proposals.filter((proposal) => proposal.answer !== null);
  const industryIds = new Set([
    ...answered.flatMap((proposal) => proposal.answer?.assignments.map((a) => a.industry_id) ?? []),
    ...gold.industries.map((industry) => industry.industryId),
  ]);
  const taxonomy =
    industryIds.size === 0
      ? []
      : await db
          .select()
          .from(industries)
          .where(
            and(
              eq(industries.snapshotId, draft.snapshotId),
              inArray(industries.industryId, [...industryIds]),
            ),
          );
  const taxonomyById = new Map(taxonomy.map((industry) => [industry.industryId, industry]));
  const reviewIndustries = [...industryIds].sort().map((industryId): GoldReviewIndustry => {
    const proposedBy = answered
      .filter((proposal) => proposal.answer?.assignments.some((a) => a.industry_id === industryId))
      .map((proposal) => proposal.runId);
    const entry = taxonomyById.get(industryId);
    return {
      industryId,
      industryName: entry?.industryName ?? null,
      sectorName: entry?.sectorName ?? null,
      description: entry?.description ?? null,
      proposedBy,
      unanimous: proposedBy.length > 0 && proposedBy.length === answered.length,
      gold: gold.industries.find((industry) => industry.industryId === industryId) ?? null,
    };
  });

  return {
    unit,
    gold,
    proposals,
    industries: reviewIndustries,
    decisionsDiffer: new Set(answered.map((proposal) => proposal.answer?.decision)).size > 1,
  };
}

async function proposalRunIdsOf(db: Database, goldVersionId: number): Promise<number[]> {
  const rows = await db
    .select({ runId: goldProposalRuns.runId })
    .from(goldProposalRuns)
    .where(eq(goldProposalRuns.goldVersionId, goldVersionId))
    .orderBy(asc(goldProposalRuns.runId));
  return rows.map((row) => row.runId);
}

async function industryIdsOf(db: Database, snapshotId: number): Promise<Set<string>> {
  const rows = await db
    .select({ industryId: industries.industryId })
    .from(industries)
    .where(eq(industries.snapshotId, snapshotId));
  return new Set(rows.map((row) => row.industryId));
}

async function ensureDraft(tx: Database): Promise<typeof goldVersions.$inferSelect> {
  const [existing] = await tx.select().from(goldVersions).where(eq(goldVersions.status, "draft"));
  if (existing) return existing;
  const snapshot = await getCurrentSnapshot(tx);
  if (!snapshot) throw new Error("Kein Snapshot geladen");
  const [created] = await tx
    .insert(goldVersions)
    .values({ snapshotId: snapshot.snapshotId, snapshotHash: snapshot.contentHash })
    .returning();
  return created;
}

async function requireDraft(db: Database): Promise<typeof goldVersions.$inferSelect> {
  const [draft] = await db.select().from(goldVersions).where(eq(goldVersions.status, "draft"));
  if (!draft) throw new Error("Es gibt keinen Gold-Entwurf");
  return draft;
}

async function withUnits(db: Database, row: typeof goldVersions.$inferSelect): Promise<GoldVersionView> {
  const unitRows = await db
    .select()
    .from(goldUnits)
    .where(eq(goldUnits.goldVersionId, row.id))
    .orderBy(asc(goldUnits.unitId));
  const industryRows =
    unitRows.length === 0
      ? []
      : await db
          .select()
          .from(goldIndustries)
          .where(eq(goldIndustries.goldVersionId, row.id))
          .orderBy(asc(goldIndustries.industryId));
  const industriesByUnit = Map.groupBy(industryRows, (industry) => industry.unitId);
  const [summary] = await toVersionSummaries(db, [row]);
  return {
    ...summary,
    units: unitRows.map(
      (unit): GoldUnit => ({
        unitId: unit.unitId,
        category: unit.category,
        noMapping: unit.noMapping,
        note: unit.note,
        industries: (industriesByUnit.get(unit.unitId) ?? []).map((industry) => ({
          industryId: industry.industryId,
          class: industry.class,
          webOnly: industry.webOnly,
        })),
      }),
    ),
  };
}

const isDraft = eq(goldVersions.status, "draft");

/** Zusammenfassungen ohne Units, mit dem Label des Ausgangspunkts. */
async function toVersionSummaries(
  db: Database,
  rows: (typeof goldVersions.$inferSelect)[],
): Promise<Omit<GoldVersionView, "units">[]> {
  const baseIds = [
    ...new Set(rows.flatMap((row) => (row.baseVersionId === null ? [] : [row.baseVersionId]))),
  ];
  const bases =
    baseIds.length === 0
      ? []
      : await db
          .select({ id: goldVersions.id, label: goldVersions.label })
          .from(goldVersions)
          .where(inArray(goldVersions.id, baseIds));
  const labelOf = new Map(bases.map((base) => [base.id, base.label]));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    status: row.status,
    snapshotId: row.snapshotId,
    snapshotHash: row.snapshotHash,
    baseLabel: row.baseVersionId === null ? null : (labelOf.get(row.baseVersionId) ?? null),
    createdAt: row.createdAt,
    frozenAt: row.frozenAt,
  }));
}
