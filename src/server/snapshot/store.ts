import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import { industries, snapshots, unitCleanups, units } from "@/server/db/schema";
import type { Cleanup, Industry, Snapshot, SnapshotSource, SnapshotUnit } from "./model";

/**
 * Snapshot in der Datenbank: Laden (idempotent über den Content-Hash) und Lesen für GUI und Läufe.
 * Als aktueller Snapshot gilt der zuletzt geladene.
 */

export interface SnapshotSummary {
  snapshotId: number;
  version: string;
  contentHash: string;
  loadedAt: Date;
  unitCount: number;
  nameOnlyCount: number;
  industryCount: number;
  cleanupCount: number;
}

export type UnitView = Omit<SnapshotUnit, "sourceInputHash"> & { cleanups: Omit<Cleanup, "unitId">[] };

export interface SearchOptions {
  /** Freitext; Groß-/Kleinschreibung egal. Leer oder fehlend = alles. */
  query?: string;
}

/** Lädt einen Snapshot, falls einer mit demselben Content-Hash noch nicht geladen ist. */
export async function loadSnapshot(
  db: Database,
  snapshot: Snapshot,
): Promise<{ snapshotId: number; created: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(eq(snapshots.contentHash, snapshot.contentHash));
    if (existing) return { snapshotId: existing.id, created: false };

    const [row] = await tx
      .insert(snapshots)
      .values({
        version: snapshot.version,
        contentHash: snapshot.contentHash,
        format: snapshot.format,
        source: snapshot.source,
      })
      .returning({ id: snapshots.id });
    const snapshotId = row.id;
    await tx.insert(units).values(snapshot.units.map((unit) => ({ ...unit, snapshotId })));
    await tx.insert(industries).values(snapshot.industries.map((industry) => ({ ...industry, snapshotId })));
    if (snapshot.cleanups.length > 0) {
      await tx
        .insert(unitCleanups)
        .values(snapshot.cleanups.map((cleanup, position) => ({ ...cleanup, snapshotId, position })));
    }
    return { snapshotId, created: true };
  });
}

export async function getCurrentSnapshot(db: Database): Promise<SnapshotSummary | null> {
  const [current] = await db.select().from(snapshots).orderBy(desc(snapshots.id)).limit(1);
  if (!current) return null;
  const countOf = async (table: typeof units | typeof industries | typeof unitCleanups, extra?: SQL) => {
    const [result] = await db
      .select({ value: count() })
      .from(table)
      .where(and(eq(table.snapshotId, current.id), extra));
    return result.value;
  };
  return {
    snapshotId: current.id,
    version: current.version,
    contentHash: current.contentHash,
    loadedAt: current.loadedAt,
    unitCount: await countOf(units),
    nameOnlyCount: await countOf(units, eq(units.inputBasis, "name_only")),
    industryCount: await countOf(industries),
    cleanupCount: await countOf(unitCleanups),
  };
}

export interface SnapshotContentView {
  snapshotId: number;
  version: string;
  contentHash: string;
  source: SnapshotSource;
  /** Reihenfolge nicht festgelegt; wer sie braucht (z. B. der Benchmark-Prompt), sortiert selbst. */
  units: SnapshotUnit[];
  industries: Industry[];
}

/** Units, Industries und Quelle eines geladenen Snapshots, z. B. als Eingabe für den Benchmark-Prompt. */
export async function getSnapshotContent(
  db: Database,
  snapshotId: number,
): Promise<SnapshotContentView | null> {
  const [row] = await db.select().from(snapshots).where(eq(snapshots.id, snapshotId));
  if (!row) return null;
  const unitRows = await db.select().from(units).where(eq(units.snapshotId, snapshotId));
  const industryRows = await db.select().from(industries).where(eq(industries.snapshotId, snapshotId));
  return {
    snapshotId,
    version: row.version,
    contentHash: row.contentHash,
    source: row.source,
    units: unitRows.map(({ snapshotId: _snapshotId, ...unit }) => unit),
    industries: industryRows.map(({ snapshotId: _snapshotId, ...industry }) => industry),
  };
}

/** Units des aktuellen Snapshots, gesucht in ID, Name, Committee und Zuständigkeitstext. */
export async function searchUnits(db: Database, options: SearchOptions): Promise<UnitView[]> {
  const current = await getCurrentSnapshotId(db);
  if (current === null) return [];
  const pattern = likePattern(options.query);
  const rows = await db
    .select()
    .from(units)
    .where(
      and(
        eq(units.snapshotId, current),
        pattern
          ? or(
              ilike(units.unitId, pattern),
              ilike(units.unitName, pattern),
              ilike(units.committeeName, pattern),
              ilike(units.jurisdictionText, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(asc(units.unitId));
  const cleanups = await db
    .select()
    .from(unitCleanups)
    .where(eq(unitCleanups.snapshotId, current))
    .orderBy(asc(unitCleanups.position));
  const cleanupsByUnit = Map.groupBy(cleanups, (cleanup) => cleanup.unitId);
  return rows.map(({ snapshotId: _snapshotId, sourceInputHash: _hash, ...unit }) => ({
    ...unit,
    cleanups: (cleanupsByUnit.get(unit.unitId) ?? []).map(({ kind, before, after, reason }) => ({
      kind: kind as Cleanup["kind"],
      before,
      after,
      reason,
    })),
  }));
}

/** Industries des aktuellen Snapshots, gesucht in ID, Name, Sektor und Beschreibung. */
export async function searchIndustries(db: Database, options: SearchOptions): Promise<Industry[]> {
  const current = await getCurrentSnapshotId(db);
  if (current === null) return [];
  const pattern = likePattern(options.query);
  return db
    .select({
      industryId: industries.industryId,
      industryName: industries.industryName,
      sectorId: industries.sectorId,
      sectorName: industries.sectorName,
      description: industries.description,
    })
    .from(industries)
    .where(
      and(
        eq(industries.snapshotId, current),
        pattern
          ? or(
              ilike(industries.industryId, pattern),
              ilike(industries.industryName, pattern),
              ilike(industries.sectorName, pattern),
              ilike(industries.description, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(asc(industries.sectorName), asc(industries.industryName));
}

async function getCurrentSnapshotId(db: Database): Promise<number | null> {
  const [current] = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .orderBy(desc(snapshots.id))
    .limit(1);
  return current?.id ?? null;
}

function likePattern(query: string | undefined): string | null {
  const trimmed = query?.trim();
  if (!trimmed) return null;
  return `%${trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
