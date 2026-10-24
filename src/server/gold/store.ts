import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import { goldIndustries, goldUnits, goldVersions, units } from "@/server/db/schema";
import { getCurrentSnapshot } from "@/server/snapshot/store";
import { type GoldCategory, type GoldUnit, type GoldVersionView, MAX_GOLD_UNITS } from "./model";

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
          .where(inArray(goldIndustries.goldVersionId, [row.id]))
          .orderBy(asc(goldIndustries.industryId));
  const industriesByUnit = Map.groupBy(industryRows, (industry) => industry.unitId);
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    snapshotId: row.snapshotId,
    snapshotHash: row.snapshotHash,
    createdAt: row.createdAt,
    frozenAt: row.frozenAt,
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
