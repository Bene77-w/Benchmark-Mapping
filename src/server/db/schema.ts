import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { GOLD_CATEGORIES, GOLD_CLASSES, GOLD_VERSION_STATUSES } from "@/server/gold/model";
import { HARNESS_ERROR_KINDS, HARNESSES, type TokensByModel } from "@/server/harness/adapter";
import type { PreflightResult } from "@/server/harness/preflight";
import { MODES, RUN_KINDS } from "@/server/prompt/benchmark-prompt";
import type { UnitAnswer } from "@/server/prompt/output-schema";
import { RUN_STATUSES, UNIT_RESULT_STATUSES } from "@/server/runs/model";
import type { RunEvaluation } from "@/server/scoring/model";
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
  /**
   * Gold-Version, deren Units der Lauf beim Start übernommen hat (`gold-v1`, …); `null` bei Vorschlagsläufen
   * und Läufen von vor dieser Spalte. Bewertet wird trotzdem gegen die neueste Gold-Version.
   */
  goldVersion: text("gold_version"),
  /** Ergebnis des letzten Preflights vor der Ausführung (`null`, solange keiner lief oder der Adapter keinen hat). */
  preflight: jsonb("preflight").$type<PreflightResult>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** Bei Ratenlimit: Zeitpunkt der nächsten stellvertretenden Nachfrage; sonst `null`. */
  rateLimitedUntil: timestamp("rate_limited_until", { withTimezone: true }),
  /** Lebenszeichen des Workers, der den Lauf ausführt; veraltet es, gilt der Lauf als verwaist. */
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  /** Kennung der letzten Übernahme durch einen Worker; nur dieser darf den Lauf weiter ausführen. */
  claimId: text("claim_id"),
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
    /** Tokens je Modell, wenn der Harness sie getrennt meldet (Summe in den Spalten davor). */
    tokensByModel: jsonb("tokens_by_model").$type<TokensByModel>(),
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

/**
 * Gold-Version: höchstens ein Entwurf (`draft`, ohne Label), den die Gold-Review bearbeitet; der Abschluss
 * friert ihn als `gold-vN` ein (`frozen`, danach unveränderlich). Bezieht sich auf einen Snapshot. Ein Entwurf kann
 * eine bestehende Gold-Version als Ausgangspunkt übernehmen (`baseVersionId`).
 */
export const goldVersions = pgTable(
  "gold_versions",
  {
    id: serial("id").primaryKey(),
    label: text("label").unique(),
    status: text("status", { enum: GOLD_VERSION_STATUSES }).notNull().default("draft"),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id),
    snapshotHash: text("snapshot_hash").notNull(),
    /** Gold-Version, die als Ausgangspunkt übernommen wurde; `null` bei einem Entwurf von Grund auf. */
    baseVersionId: integer("base_version_id").references((): AnyPgColumn => goldVersions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("gold_versions_one_draft").on(table.status).where(sql`status = 'draft'`)],
);

/** Gold-Unit: Unit des Gold-Sets mit Kategorie, no_mapping und Begründungsnotiz. */
export const goldUnits = pgTable(
  "gold_units",
  {
    goldVersionId: integer("gold_version_id")
      .notNull()
      .references(() => goldVersions.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull(),
    category: text("category", { enum: GOLD_CATEGORIES }).notNull(),
    noMapping: boolean("no_mapping").notNull().default(false),
    note: text("note"),
  },
  (table) => [primaryKey({ columns: [table.goldVersionId, table.unitId] })],
);

/** Gold-Industry: Industry einer Gold-Unit mit Klasse und web_only. */
export const goldIndustries = pgTable(
  "gold_industries",
  {
    goldVersionId: integer("gold_version_id").notNull(),
    unitId: text("unit_id").notNull(),
    industryId: text("industry_id").notNull(),
    class: text("class", { enum: GOLD_CLASSES }).notNull(),
    webOnly: boolean("web_only").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.goldVersionId, table.unitId, table.industryId] }),
    foreignKey({
      columns: [table.goldVersionId, table.unitId],
      foreignColumns: [goldUnits.goldVersionId, goldUnits.unitId],
    }).onDelete("cascade"),
  ],
);

/** Vorschlagsläufe, die für eine Gold-Version gestartet wurden (Quelle der Vorschläge in der Gold-Review). */
export const goldProposalRuns = pgTable(
  "gold_proposal_runs",
  {
    goldVersionId: integer("gold_version_id")
      .notNull()
      .references(() => goldVersions.id, { onDelete: "cascade" }),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.goldVersionId, table.runId] })],
);

/**
 * Bewertung eines Laufs gegen eine Gold-Version (ein Eintrag je Lauf und Gold-Version). `result` ist die
 * vollständige Bewertung; die Kennzahlen stehen zusätzlich als Spalten für Rangliste und Diagramme.
 * `goldHash` und `scoringVersion` zeigen, ob die Bewertung zum aktuellen Gold-Inhalt und Regelstand passt.
 */
export const evaluations = pgTable(
  "evaluations",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    goldVersion: text("gold_version").notNull(),
    goldHash: text("gold_hash").notNull(),
    scoringVersion: text("scoring_version").notNull(),
    /** Jede Unit der Gold-Version hat ein Ergebnis; sonst ist der Lauf für diese Gold-Version unvollständig. */
    complete: boolean("complete").notNull(),
    score: doublePrecision("score"),
    intervalLow: doublePrecision("interval_low"),
    intervalHigh: doublePrecision("interval_high"),
    formatErrors: integer("format_errors").notNull(),
    violationCount: integer("violation_count").notNull(),
    evidenceFidelity: doublePrecision("evidence_fidelity"),
    result: jsonb("result").$type<RunEvaluation>().notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.goldVersion] })],
);

/**
 * Modell der Preistabelle, Schlüssel ist die Modell-ID wie in der Konfiguration. Ein Eintrag ohne Preise ist
 * erlaubt: Läufe mit unbekanntem Modell legen ihn an, ihre Kosten sind „unbekannt“, bis ein Preis gepflegt ist.
 */
export const models = pgTable("models", {
  id: text("id").primaryKey(),
  /** Herkunft des Eintrags, z. B. „models.dev 2026-10-24“, „Lauf“ oder „manuell“. */
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Preise eines Modells in USD pro Million Tokens, gültig ab `validFrom` (bis zum nächsten Eintrag). */
export const modelPrices = pgTable(
  "model_prices",
  {
    id: serial("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    input: doublePrecision("input").notNull(),
    /** `null` = kein Tarif bekannt. */
    cacheRead: doublePrecision("cache_read"),
    cacheWrite: doublePrecision("cache_write"),
    output: doublePrecision("output").notNull(),
    source: text("source").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.modelId, table.validFrom)],
);

/** Preis pro Websuche in USD je Harness, gültig ab `validFrom`. */
export const webSearchPrices = pgTable(
  "web_search_prices",
  {
    id: serial("id").primaryKey(),
    harness: text("harness", { enum: HARNESSES }).notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    perSearch: doublePrecision("per_search").notNull(),
    source: text("source").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.harness, table.validFrom)],
);
