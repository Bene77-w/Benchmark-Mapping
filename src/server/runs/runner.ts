import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db/database";
import { configurations, runs, unitResults } from "@/server/db/schema";
import type { AdapterRegistry, HarnessAdapter, HarnessResult, HarnessTask } from "@/server/harness/adapter";
import { type BenchmarkPrompt, buildBenchmarkPrompt } from "@/server/prompt/benchmark-prompt";
import { getSnapshotContent } from "@/server/snapshot/store";
import type { PromptRootOption } from "./store";

/**
 * Runner: führt Läufe aus der Datenbank aus. Der Worker-Prozess ruft `processNextRun` in einer Schleife auf;
 * Tests rufen es direkt auf (Seam 1). Je Unit ein Aufruf über den Harness-Adapter mit höchstens
 * `parallelism` gleichzeitigen Aufrufen; jedes Ergebnis wird sofort geschrieben.
 */

export interface RunnerDeps extends PromptRootOption {
  adapters: AdapterRegistry;
}

/**
 * Übernimmt den ältesten wartenden Lauf und führt ihn aus. Liefert seine ID oder `null`, wenn keiner wartet.
 * Mehrere Worker können parallel arbeiten: ein Lauf wird genau einmal übernommen.
 */
export async function processNextRun(db: Database, deps: RunnerDeps): Promise<number | null> {
  const [claimed] = await db
    .update(runs)
    .set({ status: "running", startedAt: sql`coalesce(${runs.startedAt}, now())` })
    .where(
      eq(
        runs.id,
        sql`(select ${runs.id} from ${runs} where ${runs.status} = 'queued' order by ${runs.id} limit 1 for update skip locked)`,
      ),
    )
    .returning({ id: runs.id });
  if (!claimed) return null;
  try {
    await executeRun(db, claimed.id, deps);
  } catch (error) {
    await db
      .update(runs)
      .set({ status: "failed", error: error instanceof Error ? error.message : String(error) })
      .where(eq(runs.id, claimed.id));
  }
  return claimed.id;
}

async function executeRun(db: Database, runId: number, deps: RunnerDeps): Promise<void> {
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
  const task = { model: configuration.model, effort: configuration.effort, mode: configuration.mode };
  await forEachLimited(
    open.map(({ unitId }) => unitId),
    run.parallelism,
    (unitId) => runUnit(db, runId, adapter, prompt, { ...task, timeoutMs: run.timeoutMs, unitId }),
  );

  const [{ value: unfinished }] = await db
    .select({ value: count() })
    .from(unitResults)
    .where(and(eq(unitResults.runId, runId), inArray(unitResults.status, ["pending", "running"])));
  if (unfinished === 0) {
    await db.update(runs).set({ status: "completed", finishedAt: new Date() }).where(eq(runs.id, runId));
  }
}

async function runUnit(
  db: Database,
  runId: number,
  adapter: HarnessAdapter,
  prompt: BenchmarkPrompt,
  task: Omit<HarnessTask, "systemPrompt" | "userPrompt" | "outputSchema">,
): Promise<void> {
  const unitPrompt = prompt.forUnit(task.unitId);
  const where = and(eq(unitResults.runId, runId), eq(unitResults.unitId, task.unitId));
  await db
    .update(unitResults)
    .set({
      status: "running",
      startedAt: new Date(),
      unitPromptHash: unitPrompt.unitPromptHash,
      attempts: sql`${unitResults.attempts} + 1`,
    })
    .where(where);

  let result = await callAdapter(adapter, task, unitPrompt, prompt);
  if (RETRYABLE.has(result.outcome.kind)) {
    await db
      .update(unitResults)
      .set({ attempts: sql`${unitResults.attempts} + 1` })
      .where(where);
    result = combineAttempts([result, await callAdapter(adapter, task, unitPrompt, prompt)]);
  }
  await db.update(unitResults).set(resultColumns(result)).where(where);
}

/** Fehlerarten, die genau einen Wiederholversuch auslösen; danach zählen sie als Format-Fehler. */
const RETRYABLE = new Set<HarnessResult["outcome"]["kind"]>(["timeout", "invalid_json", "schema_violation"]);

async function callAdapter(
  adapter: HarnessAdapter,
  task: Omit<HarnessTask, "systemPrompt" | "userPrompt" | "outputSchema">,
  unitPrompt: { systemPrompt: string; userPrompt: string },
  prompt: BenchmarkPrompt,
): Promise<HarnessResult> {
  try {
    return await adapter.run({
      ...task,
      systemPrompt: unitPrompt.systemPrompt,
      userPrompt: unitPrompt.userPrompt,
      outputSchema: prompt.outputSchema,
    });
  } catch (error) {
    return adapterFailure(error);
  }
}

/**
 * Fasst die Versuche einer Unit zusammen: Antwort bzw. Fehlerart und Metadaten des letzten Versuchs; Tokens,
 * Websuchen, native Kosten und Dauer aller Versuche (bezahlt ist jeder), Protokolle nacheinander.
 */
function combineAttempts(attempts: HarnessResult[]): HarnessResult {
  const last = attempts[attempts.length - 1];
  const withTokens = attempts.flatMap((attempt) => (attempt.tokens ? [attempt.tokens] : []));
  return {
    ...last,
    log: attempts.map((attempt, index) => `--- Versuch ${index + 1} ---\n${attempt.log}`).join("\n"),
    tokens:
      withTokens.length === 0
        ? null
        : {
            inputTokens: sum(withTokens.map((tokens) => tokens.inputTokens)) ?? 0,
            cacheReadTokens: sum(withTokens.map((tokens) => tokens.cacheReadTokens)) ?? 0,
            cacheWriteTokens: sum(withTokens.map((tokens) => tokens.cacheWriteTokens)) ?? 0,
            outputTokens: sum(withTokens.map((tokens) => tokens.outputTokens)) ?? 0,
            reasoningTokens: sum(withTokens.map((tokens) => tokens.reasoningTokens)),
          },
    webSearches: sum(attempts.map((attempt) => attempt.webSearches)),
    nativeCostUsd: sum(attempts.map((attempt) => attempt.nativeCostUsd)),
    durationMs: sum(attempts.map((attempt) => attempt.durationMs)) ?? 0,
  };
}

/** Summe der bekannten Werte; `null`, wenn keiner bekannt ist. */
function sum(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
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
  return {
    outcome: { kind: "harness_error", message },
    rawResponse: null,
    log: message,
    tokens: null,
    webSearches: null,
    effort: { reported: null, confirmed: false },
    nativeCostUsd: null,
    durationMs: 0,
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
