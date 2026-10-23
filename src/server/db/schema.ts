import { integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { SnapshotSource } from "@/server/snapshot/model";

/** Ein geladener Snapshot. Läufe beziehen sich später auf ihn (über `id` bzw. `contentHash`). */
export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  version: text("version").notNull(),
  contentHash: text("content_hash").notNull().unique(),
  format: text("format").notNull(),
  source: jsonb("source").$type<SnapshotSource>().notNull(),
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const units = pgTable(
  "units",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull(),
    kind: text("kind", { enum: ["subcommittee", "committee_parent_core", "committee_direct"] }).notNull(),
    chamber: text("chamber", { enum: ["house", "senate", "joint"] }).notNull(),
    committeeName: text("committee_name").notNull(),
    unitName: text("unit_name").notNull(),
    parentUnitId: text("parent_unit_id"),
    parentCommitteeName: text("parent_committee_name"),
    parentContextText: text("parent_context_text"),
    inputBasis: text("input_basis", { enum: ["jurisdiction_text", "name_only"] }).notNull(),
    jurisdictionText: text("jurisdiction_text"),
    sourcePath: text("source_path").notNull(),
    sourceInputHash: text("source_input_hash").notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.unitId] })],
);

export const industries = pgTable(
  "industries",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    industryId: text("industry_id").notNull(),
    industryName: text("industry_name").notNull(),
    sectorId: text("sector_id").notNull(),
    sectorName: text("sector_name").notNull(),
    description: text("description").notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.industryId] })],
);

/** Bereinigungsprotokoll des Snapshots; `position` ist die Reihenfolge im Register. */
export const unitCleanups = pgTable(
  "unit_cleanups",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    unitId: text("unit_id").notNull(),
    kind: text("kind").notNull(),
    before: text("before").notNull(),
    after: text("after").notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.position] })],
);
