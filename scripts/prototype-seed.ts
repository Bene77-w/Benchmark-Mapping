/**
 * PROTOTYP – wegwerfen (Branch `prototyp/diagramme`): füllt die Scratch-Datenbank `prototyp_diagramme` mit einer
 * Fake-Gold-Version (die empfohlenen 30 Kandidaten, Industries ausgewürfelt) und Fake-Läufen über mehrere
 * Konfigurationen und Wochen, damit die Diagramme der Auswertung (`?variant=svg` / `?variant=recharts`)
 * aussagekräftig sind. Kein Modell- oder CLI-Aufruf: ein In-Process-Adapter erzeugt die Antworten, der echte
 * Runner schreibt sie wie bei einem Lauf. Idempotent: gibt es schon Läufe, passiert nichts.
 *
 *   pnpm prototype:diagramme   (Container, Seed, next dev auf 127.0.0.1:3130)
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { MIGRATIONS_FOLDER } from "@/server/db/database";
import * as schema from "@/server/db/schema";
import { runs } from "@/server/db/schema";
import {
  adoptRecommendedCandidates,
  finalizeGoldDraft,
  getGoldDraft,
  saveGoldUnitDecision,
} from "@/server/gold/store";
import { type HarnessAdapter, type HarnessResult, parseAnswerText } from "@/server/harness/adapter";
import { readModelsDevSnapshot } from "@/server/pricing/models-dev";
import { getPriceTable, loadModelsDevSnapshot, saveModelPrice } from "@/server/pricing/store";
import { processNextRun } from "@/server/runs/runner";
import { createRun } from "@/server/runs/store";
import { readSnapshotFile, SNAPSHOT_PATH } from "@/server/snapshot/snapshot-file";
import { getCurrentSnapshot, getSnapshotContent, loadSnapshot } from "@/server/snapshot/store";

const url = process.env.DATABASE_URL;
if (!url || !url.includes("prototyp")) {
  throw new Error("DATABASE_URL muss auf die Scratch-Datenbank zeigen (Name mit „prototyp“)");
}

// 1. Datenbank anlegen (im eigenen Container `benchmark-prototyp-diagramme`).
const target = new URL(url);
const dbName = target.pathname.slice(1);
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const admin = new Pool({ connectionString: adminUrl.toString() });
const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
if (!rowCount) await admin.query(`create database "${dbName}"`);
await admin.end();

const pool = new Pool({ connectionString: url });
const db = drizzle({ client: pool, schema });

// 2. Wie `pnpm db:prepare`: Migrationen, Snapshot, Preistabelle.
await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
await loadSnapshot(db, await readSnapshotFile(SNAPSHOT_PATH));
await loadModelsDevSnapshot(db, await readModelsDevSnapshot());

if ((await db.select({ id: runs.id }).from(runs).limit(1)).length > 0) {
  console.log(`Prototyp-Datenbank ${dbName} ist schon gefüllt.`);
  await pool.end();
  process.exit(0);
}

/** Reproduzierbarer Zufall. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261025);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

const current = await getCurrentSnapshot(db);
const snapshot = current && (await getSnapshotContent(db, current.snapshotId));
if (!snapshot) throw new Error("Kein Snapshot geladen");
const industryIds = snapshot.industries.map((industry) => industry.industryId);
const unitsById = new Map(snapshot.units.map((unit) => [unit.unitId, unit]));

// 3. Fake-Gold: empfohlene Kandidaten, Kategorie c ohne Mapping, sonst 1–2 positive (+ evtl. 1 vertretbare).
await adoptRecommendedCandidates(db);
const draft = await getGoldDraft(db);
if (!draft) throw new Error("Kein Gold-Entwurf");
const goldPlan = new Map<
  string,
  { category: string; noMapping: boolean; positiv: string[]; vertretbar: string[] }
>();
for (const unit of draft.units) {
  const noMapping = unit.category === "c";
  const shuffled = [...industryIds].sort(() => random() - 0.5);
  const positiv = noMapping ? [] : shuffled.slice(0, random() < 0.5 ? 1 : 2);
  const vertretbar = noMapping || random() < 0.4 ? [] : shuffled.slice(2, 3);
  goldPlan.set(unit.unitId, { category: unit.category, noMapping, positiv, vertretbar });
  await saveGoldUnitDecision(db, unit.unitId, {
    category: unit.category,
    noMapping,
    note: "PROTOTYP-Fake-Gold",
    industries: [
      ...positiv.map((industryId) => ({ industryId, class: "positiv" as const, webOnly: false })),
      ...vertretbar.map((industryId) => ({ industryId, class: "vertretbar" as const, webOnly: false })),
    ],
  });
}
const { label } = await finalizeGoldDraft(db);
console.log(`Fake-Gold ${label} mit ${goldPlan.size} Units.`);

// 4. Konfigurationen: Stärke je Kategorie, Tokens, Dauer. qwen hat keinen Preis (Kosten „unbekannt“).
interface ConfigSpec {
  harness: "claude_code" | "codex" | "opencode";
  model: string;
  effort: string;
  base: number;
  /** Abweichung je Kategorie a–f. */
  bias: Record<string, number>;
  runs: number;
  trend: number;
  tokens: { input: number; cacheRead: number; output: number };
  durationMs: number;
  formatErrors: number;
}
const flat = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
const CONFIGS: ConfigSpec[] = [
  {
    harness: "claude_code",
    model: "claude-opus-5-5",
    effort: "high",
    base: 0.86,
    bias: { ...flat, f: 0.05, e: 0.03 },
    runs: 5,
    trend: 0.03,
    tokens: { input: 5200, cacheRead: 36000, output: 2400 },
    durationMs: 48_000,
    formatErrors: 0,
  },
  {
    harness: "claude_code",
    model: "claude-opus-5-5",
    effort: "medium",
    base: 0.82,
    bias: { ...flat, f: 0.02 },
    runs: 4,
    trend: 0.02,
    tokens: { input: 5100, cacheRead: 36000, output: 1300 },
    durationMs: 30_000,
    formatErrors: 0,
  },
  {
    harness: "claude_code",
    model: "claude-sonnet-5-5",
    effort: "medium",
    base: 0.78,
    bias: { ...flat, c: 0.08, f: -0.06 },
    runs: 5,
    trend: 0.04,
    tokens: { input: 5100, cacheRead: 36000, output: 1100 },
    durationMs: 22_000,
    formatErrors: 0.01,
  },
  {
    harness: "claude_code",
    model: "claude-haiku-5-5",
    effort: "low",
    base: 0.62,
    bias: { ...flat, c: 0.15, e: -0.12, f: -0.15 },
    runs: 4,
    trend: 0.0,
    tokens: { input: 5000, cacheRead: 36000, output: 500 },
    durationMs: 9_000,
    formatErrors: 0.03,
  },
  {
    harness: "codex",
    model: "gpt-5.5",
    effort: "high",
    base: 0.84,
    bias: { ...flat, a: 0.05, c: -0.08 },
    runs: 5,
    trend: -0.02,
    tokens: { input: 6000, cacheRead: 30000, output: 2900 },
    durationMs: 55_000,
    formatErrors: 0,
  },
  {
    harness: "codex",
    model: "gpt-5.5",
    effort: "low",
    base: 0.72,
    bias: { ...flat, a: 0.04, c: -0.1 },
    runs: 3,
    trend: 0.0,
    tokens: { input: 6000, cacheRead: 30000, output: 900 },
    durationMs: 18_000,
    formatErrors: 0.02,
  },
  {
    harness: "codex",
    model: "gpt-5.4-mini",
    effort: "medium",
    base: 0.58,
    bias: { ...flat, d: 0.1, f: -0.2 },
    runs: 4,
    trend: 0.05,
    tokens: { input: 6100, cacheRead: 30000, output: 1200 },
    durationMs: 14_000,
    formatErrors: 0.04,
  },
  {
    harness: "opencode",
    model: "qwen3-coder-local",
    effort: "medium",
    base: 0.55,
    bias: { ...flat, b: 0.08, e: -0.15 },
    runs: 3,
    trend: 0.06,
    tokens: { input: 7000, cacheRead: 0, output: 1500 },
    durationMs: 70_000,
    formatErrors: 0.08,
  },
];
const CATEGORY_DIFFICULTY: Record<string, number> = { a: -0.04, b: 0, c: 0.04, d: 0.06, e: -0.1, f: -0.18 };

// Preise der models.dev-Modelle schon ab Jahresbeginn, damit auch ältere Fake-Läufe Kosten haben.
const prices = await getPriceTable(db);
for (const model of new Set(CONFIGS.map((config) => config.model))) {
  const price = prices.models[model]?.at(-1);
  if (price) await saveModelPrice(db, { modelId: model, ...price, validFrom: "2026-01-01" });
}

// Zeitplan: Läufe je Konfiguration über sechs Wochen verteilt, chronologisch angelegt.
const START = Date.parse("2026-09-12T09:00:00Z");
const SPAN = Date.parse("2026-10-24T17:00:00Z") - START;
const schedule = CONFIGS.flatMap((config) =>
  Array.from({ length: config.runs }, (_, index) => ({
    config,
    index,
    at: new Date(START + ((index + random() * 0.6) / config.runs) * SPAN),
  })),
).sort((a, b) => a.at.getTime() - b.at.getTime());

/** Format-Fehler bleiben auch beim Wiederholversuch des Runners bestehen. */
let active: { config: ConfigSpec; quality: number; formatErrors: Set<string> } | null = null;
const clamp = (value: number) => Math.min(0.98, Math.max(0.05, value));

function answerFor(unitId: string, config: ConfigSpec, quality: number, formatErrors: Set<string>): string {
  const gold = goldPlan.get(unitId);
  const unit = unitsById.get(unitId);
  if (!gold || !unit) throw new Error(`Unit ${unitId} fehlt`);
  if (formatErrors.has(unitId) || random() < config.formatErrors) {
    formatErrors.add(unitId);
    return "Hier ist meine Antwort: (kein JSON)";
  }
  const q = clamp(quality + CATEGORY_DIFFICULTY[gold.category] + (config.bias[gold.category] ?? 0));
  const excerpt = (unit.jurisdictionText ?? unit.unitName).split(/\s+/).slice(0, 6).join(" ");
  let named: string[];
  if (gold.noMapping) named = random() < q ? [] : [pick(industryIds)];
  else {
    named = gold.positiv.filter(() => random() < q + 0.08);
    if (named.length < 2 && gold.vertretbar.length > 0 && random() < 0.3) named.push(gold.vertretbar[0]);
    if (named.length < 2 && random() < (1 - q) * 0.7) named.push(pick(industryIds));
  }
  named = [...new Set(named)].slice(0, 2);
  return JSON.stringify({
    unit_id: unitId,
    decision: named.length > 0 ? "mapped" : "no_mapping",
    no_mapping_reason: named.length > 0 ? null : "Keine Industry erkennbar (Prototyp-Fake).",
    broad_scope_exception: false,
    broad_scope_reason: null,
    assignments: named.map((industry_id) => ({
      industry_id,
      evidence_excerpt: excerpt,
      rationale_short: "Prototyp-Fake-Antwort.",
    })),
    sources: [],
    label_uncertain: false,
    uncertainty_note: null,
  });
}

/** In-Process-Adapter: keine CLI, keine Modellaufrufe. */
const adapter = (harness: ConfigSpec["harness"]): HarnessAdapter => ({
  harness,
  async run(task): Promise<HarnessResult> {
    if (!active) throw new Error("Kein aktiver Fake-Lauf");
    const { config, quality, formatErrors } = active;
    const raw = answerFor(task.unitId, config, quality, formatErrors);
    const jitter = () => 0.75 + random() * 0.5;
    return {
      outcome: parseAnswerText(raw, task.unitId),
      rawResponse: raw,
      log: "prototype-seed: Fake-Antwort",
      tokens: {
        inputTokens: Math.round(config.tokens.input * jitter()),
        cacheReadTokens: Math.round(config.tokens.cacheRead * jitter()),
        cacheWriteTokens: 0,
        outputTokens: Math.round(config.tokens.output * jitter()),
        reasoningTokens: null,
      },
      webSearches: 0,
      effort: { reported: task.effort, confirmed: true },
      nativeCostUsd: null,
      durationMs: Math.round(config.durationMs * jitter()),
      exitCode: 0,
      cliVersion: "prototype-seed",
      modelReported: task.model,
    };
  },
});
const adapters = {
  claude_code: adapter("claude_code"),
  codex: adapter("codex"),
  opencode: adapter("opencode"),
};

const unitIds = [...goldPlan.keys()];
for (const { config, index, at } of schedule) {
  const progress = config.runs > 1 ? index / (config.runs - 1) : 0;
  active = {
    config,
    quality: config.base + config.trend * (progress - 0.5) * 2 + (random() - 0.5) * 0.08,
    formatErrors: new Set(),
  };
  const { runId } = await createRun(db, {
    configuration: { harness: config.harness, model: config.model, effort: config.effort, mode: "text_only" },
    parallelism: 4,
    unitIds,
  });
  await processNextRun(db, { adapters, heartbeatMs: 60_000 });
  await db
    .update(runs)
    .set({ createdAt: at, startedAt: at, finishedAt: new Date(at.getTime() + 20 * 60_000) })
    .where(eq(runs.id, runId));
  console.log(`Lauf #${runId}: ${config.model} · ${config.effort} (${at.toISOString().slice(0, 10)})`);
}

await pool.end();
console.log(`Prototyp-Datenbank ${dbName}: ${schedule.length} Fake-Läufe angelegt.`);
