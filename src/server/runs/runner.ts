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

  let result: HarnessResult;
  try {
    result = await adapter.run({
      ...task,
      systemPrompt: unitPrompt.systemPrompt,
      userPrompt: unitPrompt.userPrompt,
      outputSchema: prompt.outputSchema,
    });
  } catch (error) {
    result = adapterFailure(error);
  }
  await db.update(unitResults).set(resultColumns(result)).where(where);
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
