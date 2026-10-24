import { and, asc, count, desc, eq } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import { goldIndustries, goldUnits, goldVersions, industries, units } from "@/server/db/schema";
import { getCurrentSnapshot } from "@/server/snapshot/store";
import {
  type GoldCategory,
  type GoldIssue,
  type GoldUnit,
  type GoldUnitDecision,
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

/** Prüft den Entwurf vor dem Abschluss; ohne Entwurf ist das Gold-Set leer. */
export async function checkGoldDraft(db: Database): Promise<GoldIssue[]> {
  const draft = await getGoldDraft(db);
  if (!draft) return validateGold([], new Set());
  return validateGold(draft.units, await industryIdsOf(db, draft.snapshotId));
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
  return rows.map(toVersionSummary);
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
  return {
    ...toVersionSummary(row),
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

function toVersionSummary(row: typeof goldVersions.$inferSelect): Omit<GoldVersionView, "units"> {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    snapshotId: row.snapshotId,
    snapshotHash: row.snapshotHash,
    createdAt: row.createdAt,
    frozenAt: row.frozenAt,
  };
}
