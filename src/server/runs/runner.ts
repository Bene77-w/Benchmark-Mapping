import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import { configurations, runs, unitResults } from "@/server/db/schema";
import type {
  AdapterRegistry,
  HarnessAdapter,
  HarnessResult,
  HarnessTask,
  TokenUsage,
} from "@/server/harness/adapter";
import { describePreflightFailure } from "@/server/harness/preflight";
import { type BenchmarkPrompt, buildBenchmarkPrompt } from "@/server/prompt/benchmark-prompt";
import { getSnapshotContent } from "@/server/snapshot/store";
import { RateLimitWait } from "./rate-limit";
import type { PromptRootOption } from "./store";

/**
 * Runner: führt Läufe aus der Datenbank aus. Der Worker-Prozess ruft `processNextRun` in einer Schleife auf;
 * Tests rufen es direkt auf (Seam 1). Je Unit ein Aufruf über den Harness-Adapter mit höchstens
 * `parallelism` gleichzeitigen Aufrufen; jedes Ergebnis wird sofort geschrieben.
 */

export interface RunnerDeps extends PromptRootOption {
  adapters: AdapterRegistry;
  /**
   * Spielraum über das Timeout des Laufs hinaus: meldet ein Adapter bis dahin nichts, wertet der Runner den
   * Aufruf selbst als Timeout (Standard 30 s; Adapter erzwingen das Timeout eigentlich selbst).
   */
  timeoutGraceMs?: number;
  /** Takt der stellvertretenden Nachfrage bei Ratenlimit (Standard 10 min; in Tests kürzer). */
  rateLimitRetryMs?: number;
  /** Abstand, in dem der Runner sein Lebenszeichen schreibt und auf einen Abbruch prüft (Standard 2 s). */
  heartbeatMs?: number;
  /**
   * Ein laufender Lauf, dessen Lebenszeichen älter ist, gilt als verwaist (Worker abgestürzt oder beendet)
   * und wird übernommen (Standard 60 s).
   */
  staleAfterMs?: number;
}

const DEFAULT_TIMEOUT_GRACE_MS = 30_000;
const DEFAULT_RATE_LIMIT_RETRY_MS = 10 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 2_000;
const DEFAULT_STALE_AFTER_MS = 60_000;

/**
 * Übernimmt den ältesten wartenden oder verwaisten Lauf und führt ihn aus. Liefert seine ID oder `null`, wenn
 * keiner ansteht. Mehrere Worker können parallel arbeiten: ein Lauf wird genau einmal übernommen. Bei einem
 * verwaisten Lauf werden die Units, die beim Absturz liefen, wieder offen; fertige bleiben.
 */
export async function processNextRun(db: Database, deps: RunnerDeps): Promise<number | null> {
  const staleBefore = new Date(Date.now() - (deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS));
  const next = db
    .select({ id: runs.id })
    .from(runs)
    .where(
      or(
        eq(runs.status, "queued"),
        and(eq(runs.status, "running"), or(isNull(runs.heartbeatAt), lt(runs.heartbeatAt, staleBefore))),
      ),
    )
    .orderBy(asc(runs.id))
    .limit(1)
    .for("update", { skipLocked: true });
  const claimId = randomUUID();
  const [claimed] = await db
    .update(runs)
    .set({
      claimId,
      status: "running",
      startedAt: sql`coalesce(${runs.startedAt}, now())`,
      heartbeatAt: new Date(),
      rateLimitedUntil: null,
    })
    .where(inArray(runs.id, next))
    .returning({ id: runs.id });
  if (!claimed) return null;
  await db
    .update(unitResults)
    .set({ status: "pending" })
    .where(and(eq(unitResults.runId, claimed.id), eq(unitResults.status, "running")));
  try {
    await executeRun(db, claimed.id, claimId, deps);
  } catch (error) {
    await db
      .update(runs)
      .set({ status: "failed", error: error instanceof Error ? error.message : String(error) })
      .where(eq(runs.id, claimed.id));
  }
  return claimed.id;
}

async function executeRun(db: Database, runId: number, claimId: string, deps: RunnerDeps): Promise<void> {
  const [row] = await db
    .select({ run: runs, configuration: configurations })
    .from(runs)
    .innerJoin(configurations, eq(runs.configurationId, configurations.id))
    .where(eq(runs.id, runId));
  const { run, configuration } = row;
  const adapter = deps.adapters[configuration.harness];
  if (!adapter) throw new Error(`Kein Adapter für den Harness ${configuration.harness}`);
  const snapshot = await getSnapshotContent(db, run.snapshotId);
  if (!snapshot) throw new Error(`Snapshot ${run.snapshotId} fehlt`);
  const prompt = await buildBenchmarkPrompt(
    snapshot,
    { runKind: run.kind, mode: configuration.mode },
    { promptRoot: deps.promptRoot, version: run.promptVersion },
  );
  if (prompt.promptHash !== run.promptHash) {
    throw new Error(
      `Der Benchmark-Prompt hat sich seit dem Anlegen des Laufs geändert (Hash ${prompt.promptHash} statt ${run.promptHash})`,
    );
  }

  const open = await db
    .select({ unitId: unitResults.unitId })
    .from(unitResults)
    .where(and(eq(unitResults.runId, runId), eq(unitResults.status, "pending")))
    .orderBy(asc(unitResults.unitId));
  const stop = new AbortController();
  const ownRun = and(eq(runs.id, runId), eq(runs.claimId, claimId));
  /**
   * Schreibt das Lebenszeichen und meldet den Zustand: `active`, `cancelled` (abgebrochen) oder `lost` (ein
   * anderer Worker hat den Lauf übernommen). Außer bei `active` endet auch ein Warten bei Ratenlimit.
   */
  const heartbeat = async (): Promise<RunState> => {
    const [row] = await db
      .update(runs)
      .set({ heartbeatAt: new Date() })
      .where(ownRun)
      .returning({ status: runs.status });
    const state: RunState = !row ? "lost" : row.status === "running" ? "active" : "cancelled";
    if (state !== "active") stop.abort();
    return state;
  };
  const timer = setInterval(() => void heartbeat().catch(() => {}), deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  const context: RunContext = {
    db,
    runId,
    claimId,
    adapter,
    prompt,
    task: {
      model: configuration.model,
      effort: configuration.effort,
      mode: configuration.mode,
      timeoutMs: run.timeoutMs,
    },
    timeoutGraceMs: deps.timeoutGraceMs ?? DEFAULT_TIMEOUT_GRACE_MS,
    state: heartbeat,
    rateLimit: new RateLimitWait({
      intervalMs: deps.rateLimitRetryMs ?? DEFAULT_RATE_LIMIT_RETRY_MS,
      signal: stop.signal,
      onChange: async (until) => {
        await db.update(runs).set({ rateLimitedUntil: until }).where(eq(runs.id, runId));
      },
    }),
  };
  try {
    // Preflight vor jedem (auch fortgesetzten) Lauf, mit laufendem Lebenszeichen (echte Proben dauern Sekunden);
    // ein Fehler blockiert die Ausführung, das Ergebnis bleibt am Lauf.
    if (adapter.preflight) {
      const { model, effort, mode } = configuration;
      const preflight = await adapter.preflight({ model, effort, mode });
      await db.update(runs).set({ preflight }).where(ownRun);
      if (!preflight.ok) throw new Error(describePreflightFailure(preflight));
    }
    await forEachLimited(
      open.map(({ unitId }) => unitId),
      run.parallelism,
      (unitId) => runUnit(context, unitId),
    );
  } finally {
    clearInterval(timer);
  }

  const [{ value: unfinished }] = await db
    .select({ value: count() })
    .from(unitResults)
    .where(and(eq(unitResults.runId, runId), inArray(unitResults.status, ["pending", "running"])));
  if (unfinished === 0) {
    await db.update(runs).set({ status: "completed", finishedAt: new Date() }).where(ownRun);
  }
}

type RunState = "active" | "cancelled" | "lost";

/** Was alle Units eines Laufs gemeinsam haben. */
interface RunContext {
  db: Database;
  runId: number;
  /** Kennung dieser Übernahme: nur solange der Lauf sie trägt, schreibt dieser Worker Unit-Ergebnisse. */
  claimId: string;
  adapter: HarnessAdapter;
  prompt: BenchmarkPrompt;
  task: Pick<HarnessTask, "model" | "effort" | "mode" | "timeoutMs">;
  timeoutGraceMs: number;
  /** Zustand des Laufs vor jedem Aufruf (schreibt zugleich das Lebenszeichen). */
  state: () => Promise<RunState>;
  rateLimit: RateLimitWait;
}

/** Fehlerarten, die genau einen Wiederholversuch auslösen; danach zählen sie als Format-Fehler. */
const RETRYABLE = new Set<HarnessResult["outcome"]["kind"]>(["timeout", "invalid_json", "schema_violation"]);

/**
 * Führt eine Unit aus und schreibt ihr Ergebnis. Ein Versuch zählt, sobald er beginnt (auch wenn der
 * Worker währenddessen abstürzt); ein Ratenlimit zählt nicht als Versuch: die Unit wartet mit allen anderen
 * (siehe `RateLimitWait`) und wird danach erneut aufgerufen. Timeout, ungültiges JSON und Schemaverstoß
 * lösen genau einen Wiederholversuch aus.
 */
async function runUnit(context: RunContext, unitId: string): Promise<void> {
  const { db, runId, claimId, prompt, rateLimit } = context;
  // Harnesses ohne Schema-Option bekommen Formatierungsauftrag und Schema im System-Prompt; der Unit-Hash
  // deckt dann genau diesen Text ab.
  const unitPrompt = prompt.forUnit(unitId, { inlineSchema: context.adapter.inlinesOutputSchema });
  // Jedes Schreiben nur, solange dieser Worker den Lauf hält (gleiche claimId): hat ein anderer Worker den
  // Lauf übernommen, verfallen späte Ergebnisse und Statuswechsel, auch während er die Unit selbst ausführt.
  const owned = and(
    eq(unitResults.runId, runId),
    eq(unitResults.unitId, unitId),
    inArray(
      unitResults.runId,
      db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.claimId, claimId))),
    ),
  );
  const whereRunning = and(owned, eq(unitResults.status, "running"));
  const task: HarnessTask = {
    ...context.task,
    unitId,
    systemPrompt: unitPrompt.systemPrompt,
    userPrompt: unitPrompt.userPrompt,
    outputSchema: prompt.outputSchema,
    formatInstruction: prompt.formatInstruction,
  };
  const attempts: HarnessResult[] = [];
  /**
   * Ein Aufruf, sofern der Lauf noch läuft (`null` sonst). Den Wiederholversuch einer begonnenen Unit führt
   * auch ein abgebrochener Lauf noch aus; nur ein übernommener nicht.
   */
  const call = async (): Promise<HarnessResult | null> => {
    const state = await context.state();
    if (state === "lost" || (state === "cancelled" && attempts.length === 0)) return null;
    const [started] = await db
      .update(unitResults)
      .set({
        status: "running",
        startedAt: new Date(),
        unitPromptHash: unitPrompt.unitPromptHash,
        attempts: sql`${unitResults.attempts} + 1`,
      })
      .where(and(owned, inArray(unitResults.status, ["pending", "running"])))
      .returning({ unitId: unitResults.unitId });
    if (!started) return null;
    const result = await callAdapter(context, task);
    if (result.outcome.kind === "rate_limit")
      await db.update(unitResults).set(RATE_LIMITED).where(whereRunning);
    return result;
  };

  for (;;) {
    await rateLimit.whenOpen();
    let result = await call();
    if (result?.outcome.kind === "rate_limit") {
      result = await rateLimit.represent(call);
      if (!result && (await context.state()) !== "active") return;
      if (!result) continue;
    }
    if (!result) {
      // Abgebrochen oder übernommen: die Unit bleibt bzw. wird wieder offen.
      await db.update(unitResults).set({ status: "pending" }).where(whereRunning);
      return;
    }
    attempts.push(result);
    if (attempts.length === 1 && RETRYABLE.has(result.outcome.kind)) continue;
    await db
      .update(unitResults)
      .set(resultColumns(combineAttempts(attempts)))
      .where(whereRunning);
    return;
  }
}

/** Ein Aufruf, der mit Ratenlimit endet, zählt nicht als Versuch: die Unit wartet wieder. */
const RATE_LIMITED = { status: "pending", attempts: sql`${unitResults.attempts} - 1` } as const;

/**
 * Ein Aufruf des Adapters. Wirft er, ist das ein Harness-Fehler; meldet er sich nicht bis Timeout plus
 * Spielraum, ein Timeout (der Aufruf selbst lässt sich nicht abbrechen, sein spätes Ergebnis verfällt).
 */
async function callAdapter(context: RunContext, task: HarnessTask): Promise<HarnessResult> {
  const limitMs = task.timeoutMs + context.timeoutGraceMs;
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<HarnessResult>((resolve) => {
    timer = setTimeout(() => resolve(runnerTimeout(limitMs)), limitMs);
  });
  try {
    return await Promise.race([context.adapter.run(task).catch(adapterFailure), guard]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fasst die Versuche einer Unit zusammen: Antwort bzw. Fehlerart und Metadaten des letzten Versuchs; Tokens,
 * Websuchen, native Kosten und Dauer aller Versuche (bezahlt ist jeder), Protokolle nacheinander. Fehlt ein
 * Wert bei einem Versuch, ist die Summe unbekannt (`null`), nie eine Teilsumme: auch ein Versuch ohne
 * Angabe kann verbraucht haben.
 */
function combineAttempts(attempts: HarnessResult[]): HarnessResult {
  const last = attempts[attempts.length - 1];
  if (attempts.length === 1) return last;
  const tokens = attempts.map((attempt) => attempt.tokens);
  const allTokens = tokens.every((entry): entry is TokenUsage => entry !== null) ? tokens : null;
  return {
    ...last,
    log: attempts.map((attempt, index) => `--- Versuch ${index + 1} ---\n${attempt.log}`).join("\n"),
    tokens: allTokens && {
      inputTokens: sumAll(allTokens.map((entry) => entry.inputTokens)) ?? 0,
      cacheReadTokens: sumAll(allTokens.map((entry) => entry.cacheReadTokens)) ?? 0,
      cacheWriteTokens: sumAll(allTokens.map((entry) => entry.cacheWriteTokens)) ?? 0,
      outputTokens: sumAll(allTokens.map((entry) => entry.outputTokens)) ?? 0,
      reasoningTokens: sumAll(allTokens.map((entry) => entry.reasoningTokens)),
    },
    webSearches: sumAll(attempts.map((attempt) => attempt.webSearches)),
    nativeCostUsd: sumAll(attempts.map((attempt) => attempt.nativeCostUsd)),
    durationMs: sumAll(attempts.map((attempt) => attempt.durationMs)) ?? 0,
  };
}

/** Summe aller Werte; `null`, sobald einer unbekannt ist. */
function sumAll(values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  return (values as number[]).reduce((total, value) => total + value, 0);
}

function resultColumns(result: HarnessResult): Partial<typeof unitResults.$inferInsert> {
  const { outcome } = result;
  return {
    status: outcome.kind === "answer" ? "done" : "failed",
    answer: outcome.kind === "answer" ? outcome.answer : null,
    errorKind: outcome.kind === "answer" ? null : outcome.kind,
    errorMessage: outcome.kind === "answer" ? null : outcome.message,
    rateLimitResetAt: outcome.kind === "rate_limit" ? outcome.resetAt : null,
    rawResponse: result.rawResponse,
    log: result.log,
    inputTokens: result.tokens?.inputTokens ?? null,
    cacheReadTokens: result.tokens?.cacheReadTokens ?? null,
    cacheWriteTokens: result.tokens?.cacheWriteTokens ?? null,
    outputTokens: result.tokens?.outputTokens ?? null,
    reasoningTokens: result.tokens?.reasoningTokens ?? null,
    webSearches: result.webSearches,
    effortReported: result.effort.reported,
    effortConfirmed: result.effort.confirmed,
    nativeCostUsd: result.nativeCostUsd,
    durationMs: Math.round(result.durationMs),
    exitCode: result.exitCode,
    cliVersion: result.cliVersion,
    modelReported: result.modelReported,
    finishedAt: new Date(),
  };
}

/** Ein Adapter, der wirft statt ein Ergebnis zu liefern, ergibt einen Harness-Fehler der Unit. */
function adapterFailure(error: unknown): HarnessResult {
  const message = `Adapter-Fehler: ${error instanceof Error ? error.message : String(error)}`;
  return runnerResult({ kind: "harness_error", message }, 0);
}

function runnerTimeout(limitMs: number): HarnessResult {
  const message = `Der Harness hat sich nicht innerhalb von ${limitMs} ms gemeldet; Abbruch durch den Runner`;
  return runnerResult({ kind: "timeout", message }, limitMs);
}

/** Ergebnis ohne Antwort des Harness, das der Runner selbst bildet. */
function runnerResult(
  outcome: HarnessResult["outcome"] & { message: string },
  durationMs: number,
): HarnessResult {
  return {
    outcome,
    rawResponse: null,
    log: outcome.message,
    tokens: null,
    webSearches: null,
    effort: { reported: null, confirmed: false },
    nativeCostUsd: null,
    durationMs,
    exitCode: null,
    cliVersion: null,
    modelReported: null,
  };
}

/** Ruft `fn` für alle Elemente auf, höchstens `limit` gleichzeitig. */
async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const lanes = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  });
  await Promise.all(lanes);
}
