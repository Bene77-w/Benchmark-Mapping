import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { HARNESS_ERROR_KINDS, HARNESSES } from "@/server/harness/adapter";
import { MODES, RUN_KINDS } from "@/server/prompt/benchmark-prompt";
import type { UnitAnswer } from "@/server/prompt/output-schema";
import { RUN_STATUSES, UNIT_RESULT_STATUSES } from "@/server/runs/model";
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

/**
 * Konfiguration: Harness, Modell, Effort und Modus, deren Ergebnis verglichen wird. Jede Kombination gibt es
 * genau einmal; Läufe derselben Konfiguration verweisen auf dieselbe Zeile.
 */
export const configurations = pgTable(
  "configurations",
  {
    id: serial("id").primaryKey(),
    harness: text("harness", { enum: HARNESSES }).notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    mode: text("mode", { enum: MODES }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.harness, table.model, table.effort, table.mode)],
);

/**
 * Lauf: eine Ausführung einer Konfiguration über eine feste Menge von Units (die Unit-Ergebnisse). Prompt-
 * und Snapshot-Hash halten fest, was die Modelle gesehen haben; Parallelität und Timeout gehören nicht zur
 * Konfiguration.
 */
export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  configurationId: integer("configuration_id")
    .notNull()
    .references(() => configurations.id),
  kind: text("kind", { enum: RUN_KINDS }).notNull().default("benchmark"),
  status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),
  /** Grund, falls der Lauf nicht ausgeführt werden konnte (Status `failed`). */
  error: text("error"),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => snapshots.id),
  snapshotHash: text("snapshot_hash").notNull(),
  promptVersion: text("prompt_version").notNull(),
  /** Hash der festen Anweisungstexte (`promptHash` des Benchmark-Prompts); Daten deckt `snapshotHash` ab. */
  promptHash: text("prompt_hash").notNull(),
  outputSchemaVersion: text("output_schema_version").notNull(),
  outputSchemaHash: text("output_schema_hash").notNull(),
  parallelism: integer("parallelism").notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/**
 * Unit-Ergebnis: eine Zeile je (Lauf, Unit), beim Anlegen des Laufs `pending`, während des Aufrufs `running`
 * und sofort nach der Antwort des Harness geschrieben: `done` = schemakonforme Antwort, `failed` = keine
 * verwertbare Antwort (Fehlerart in `errorKind`).
 */
export const unitResults = pgTable(
  "unit_results",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull(),
    status: text("status", { enum: UNIT_RESULT_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Hash des exakt gesendeten Texts dieser Unit (`unitPromptHash` des Benchmark-Prompts). */
    unitPromptHash: text("unit_prompt_hash"),
    answer: jsonb("answer").$type<UnitAnswer>(),
    errorKind: text("error_kind", { enum: HARNESS_ERROR_KINDS }),
    errorMessage: text("error_message"),
    rateLimitResetAt: timestamp("rate_limit_reset_at", { withTimezone: true }),
    rawResponse: text("raw_response"),
    log: text("log"),
    inputTokens: integer("input_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    webSearches: integer("web_searches"),
    effortReported: text("effort_reported"),
    effortConfirmed: boolean("effort_confirmed"),
    nativeCostUsd: doublePrecision("native_cost_usd"),
    durationMs: integer("duration_ms"),
    exitCode: integer("exit_code"),
    cliVersion: text("cli_version"),
    modelReported: text("model_reported"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.runId, table.unitId] })],
);
