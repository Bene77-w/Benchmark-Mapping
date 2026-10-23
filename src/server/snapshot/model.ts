import { z } from "zod";

/** Dateiformat des Snapshots; ändert sich nur, wenn sich die Struktur der Datei ändert. */
export const SNAPSHOT_FORMAT = "benchmark-snapshot-v1";

export const unitKindSchema = z.enum(["subcommittee", "committee_parent_core", "committee_direct"]);
export const chamberSchema = z.enum(["house", "senate", "joint"]);
export const inputBasisSchema = z.enum(["jurisdiction_text", "name_only"]);

/** Arten von Bereinigungen im Bereinigungsregister. */
export const cleanupKindSchema = z.enum([
  "kuratorennotiz",
  "deutscher_text",
  "silbentrennung",
  "zu_kurzer_text",
  "artefakt",
  "markdown",
]);

export const snapshotUnitSchema = z
  .object({
    unitId: z.string().min(1),
    kind: unitKindSchema,
    chamber: chamberSchema,
    committeeName: z.string().min(1),
    unitName: z.string().min(1),
    /** Nur bei Subcommittees: Unit-ID und Name des übergeordneten Committees. */
    parentUnitId: z.string().nullable(),
    parentCommitteeName: z.string().nullable(),
    /** Bereinigter Zuständigkeitstext des übergeordneten Committees; Kontext, nie Evidence. */
    parentContextText: z.string().nullable(),
    inputBasis: inputBasisSchema,
    /** Bereinigter Zuständigkeitstext; `null` genau dann, wenn die Unit name_only ist. */
    jurisdictionText: z.string().nullable(),
    /** Quelldatei im Korpus des Congress Trackers. */
    sourcePath: z.string(),
    /** mapping-input-v1-Hash des unbereinigten Quelltexts (wie im Congress Tracker). */
    sourceInputHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .refine((unit) => (unit.inputBasis === "name_only") === (unit.jurisdictionText === null), {
    message: "name_only-Units haben keinen Zuständigkeitstext, alle anderen einen",
  });

export const industrySchema = z.object({
  industryId: z.string().min(1),
  industryName: z.string().min(1),
  sectorId: z.string().min(1),
  sectorName: z.string().min(1),
  description: z.string().min(1),
});

export const cleanupSchema = z.object({
  unitId: z.string().min(1),
  kind: cleanupKindSchema,
  before: z.string().min(1),
  after: z.string(),
  reason: z.string().min(1),
});

export const snapshotSourceSchema = z.object({
  system: z.literal("congress_tracker"),
  corpusManifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  taxonomySnapshotId: z.string().min(1),
  taxonomyContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  yfinanceVersion: z.string().min(1),
});

export const snapshotContentSchema = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  version: z.string().regex(/^snapshot-v\d+$/),
  source: snapshotSourceSchema,
  units: z.array(snapshotUnitSchema),
  industries: z.array(industrySchema),
  cleanups: z.array(cleanupSchema),
});

export const snapshotSchema = snapshotContentSchema.extend({
  /** SHA-256 über den kanonischen Inhalt ohne dieses Feld. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type UnitKind = z.infer<typeof unitKindSchema>;
export type Chamber = z.infer<typeof chamberSchema>;
export type InputBasis = z.infer<typeof inputBasisSchema>;
export type CleanupKind = z.infer<typeof cleanupKindSchema>;
export type SnapshotUnit = z.infer<typeof snapshotUnitSchema>;
export type Industry = z.infer<typeof industrySchema>;
export type Cleanup = z.infer<typeof cleanupSchema>;
export type SnapshotSource = z.infer<typeof snapshotSourceSchema>;
export type SnapshotContent = z.infer<typeof snapshotContentSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
