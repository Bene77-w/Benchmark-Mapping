import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { type HarnessAdapter, type HarnessResult, type HarnessTask, parseAnswerText } from "./adapter";
import { runPreflight } from "./preflight";

/**
 * Fake-Harness für Tests und GUI ohne Kosten. Er liest vorbereitete Antworten aus einem Verzeichnis:
 *
 *   <root>/<Szenario>/<unit_id>.json
 *
 * Das Szenario ist das Modell der Konfiguration (z. B. Modell `standard` → `<root>/standard/`). Eine Datei
 * beschreibt einen Aufruf (siehe `fakeScenarioSchema`): entweder eine Antwort (`response`; ein Objekt wird
 * als JSON gesendet, ein String wörtlich – so entstehen auch Format-Fehler) oder ein simulierter Fehler
 * (`simulate`: timeout, rate_limit, harness_error), dazu Tokens, Websuchen, native Kosten, Vermerke und
 * Wartezeit.
 * Statt eines Aufrufs kann die Datei eine Folge `{ "calls": [...] }` enthalten: der n-te Aufruf derselben
 * Unit im selben Szenario bekommt den n-ten Eintrag, danach immer den letzten (z. B. Fehler, dann Antwort).
 */
export const FAKE_HARNESS_ROOT = "tests/fixtures/fake-harness";
export const FAKE_CLI_VERSION = "fake-harness-1";

const tokensSchema = z.strictObject({
  input: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative().default(0),
  cacheWrite: z.number().int().nonnegative().default(0),
  output: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative().nullable().default(null),
});

export const fakeScenarioSchema = z
  .strictObject({
    response: z.unknown().optional(),
    simulate: z.enum(["timeout", "rate_limit", "harness_error"]).optional(),
    /** Nur bei `simulate: rate_limit`: Zeitpunkt, zu dem das Limit laut Harness endet. */
    resetAt: z.iso.datetime({ offset: true }).optional(),
    tokens: tokensSchema.optional(),
    webSearches: z.number().int().nonnegative().default(0),
    nativeCostUsd: z.number().nonnegative().nullable().default(null),
    /** Vermerke des Aufrufs (z. B. eine simulierte, nicht gelöschte Sitzung). */
    warnings: z.array(z.string()).default([]),
    /** Simulierte Dauer des Aufrufs. */
    delayMs: z.number().int().nonnegative().default(0),
  })
  .refine((file) => (file.response === undefined) !== (file.simulate === undefined), {
    message: "Genau eines von response oder simulate angeben",
  });
export type FakeScenario = z.infer<typeof fakeScenarioSchema>;

/** Inhalt einer Szenario-Datei: ein Aufruf oder eine Folge von Aufrufen. */
export const fakeScenarioFileSchema = z.union([
  fakeScenarioSchema,
  z.strictObject({ calls: z.array(fakeScenarioSchema).min(1) }),
]);

const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

export interface FakeAdapterOptions {
  /** Wurzel der Szenarien, Standard `tests/fixtures/fake-harness`. */
  root?: string;
}

export function createFakeAdapter(options: FakeAdapterOptions = {}): HarnessAdapter {
  const root = options.root ?? FAKE_HARNESS_ROOT;
  /** Bisherige Aufrufe je Szenario-Datei (für Folgen). */
  const callCounts = new Map<string, number>();
  return {
    harness: "fake",
    async run(task) {
      const started = Date.now();
      const file = path.join(/*turbopackIgnore: true*/ root, task.model, `${task.unitId}.json`);
      const log = [`fake-harness: Szenario ${task.model}, Unit ${task.unitId}, Datei ${file}`];
      if (!SAFE_NAME.test(task.model) || !SAFE_NAME.test(task.unitId)) {
        return failure(
          task,
          started,
          log,
          `Ungültiger Szenario- oder Unit-Name: ${task.model}/${task.unitId}`,
        );
      }

      let scenario: FakeScenario;
      try {
        const parsed = fakeScenarioFileSchema.parse(
          JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")),
        );
        const call = callCounts.get(file) ?? 0;
        callCounts.set(file, call + 1);
        scenario = "calls" in parsed ? parsed.calls[Math.min(call, parsed.calls.length - 1)] : parsed;
      } catch (error) {
        return failure(task, started, log, `Keine gültige vorbereitete Antwort für ${task.unitId}: ${error}`);
      }
      if (scenario.delayMs > 0) await sleep(scenario.delayMs);

      const base = {
        log: "",
        tokens: scenario.tokens
          ? {
              inputTokens: scenario.tokens.input,
              cacheReadTokens: scenario.tokens.cacheRead,
              cacheWriteTokens: scenario.tokens.cacheWrite,
              outputTokens: scenario.tokens.output,
              reasoningTokens: scenario.tokens.reasoning,
            }
          : null,
        webSearches: scenario.webSearches,
        warnings: scenario.warnings,
        effort: { reported: task.effort, confirmed: true },
        nativeCostUsd: scenario.nativeCostUsd,
        durationMs: Date.now() - started,
        exitCode: 0 as number | null,
        cliVersion: FAKE_CLI_VERSION,
        modelReported: task.model,
      } satisfies Omit<HarnessResult, "outcome" | "rawResponse">;

      let result: HarnessResult;
      switch (scenario.simulate) {
        case "timeout":
          log.push(`Timeout nach ${task.timeoutMs} ms (simuliert)`);
          result = {
            ...base,
            outcome: { kind: "timeout", message: `Kein Ergebnis innerhalb von ${task.timeoutMs} ms` },
            rawResponse: null,
            durationMs: task.timeoutMs,
            exitCode: null,
          };
          break;
        case "rate_limit":
          log.push("Ratenlimit erreicht (simuliert)");
          result = {
            ...base,
            outcome: {
              kind: "rate_limit",
              message: "Ratenlimit erreicht (simuliert)",
              resetAt: scenario.resetAt ? new Date(scenario.resetAt) : null,
            },
            rawResponse: null,
            exitCode: 1,
          };
          break;
        case "harness_error":
          log.push("Harness-Fehler (simuliert)");
          result = {
            ...base,
            outcome: { kind: "harness_error", message: "Harness-Fehler (simuliert)" },
            rawResponse: null,
            exitCode: 1,
          };
          break;
        default: {
          const rawResponse =
            typeof scenario.response === "string" ? scenario.response : JSON.stringify(scenario.response);
          log.push(`Antwort: ${rawResponse}`);
          result = { ...base, outcome: parseAnswerText(rawResponse, task.unitId), rawResponse };
        }
      }
      return { ...result, log: log.join("\n") };
    },
    /** Preflight: das Szenario (Modell) muss als Verzeichnis existieren. */
    preflight: ({ model }) =>
      runPreflight(
        [
          {
            id: "scenario",
            label: "Szenario vorhanden",
            async run() {
              const dir = path.join(/*turbopackIgnore: true*/ root, model);
              const exists =
                SAFE_NAME.test(model) &&
                (await stat(/*turbopackIgnore: true*/ dir).then(
                  (info) => info.isDirectory(),
                  () => false,
                ));
              return exists
                ? { status: "ok", message: `Szenario ${model} in ${root}` }
                : { status: "failed", message: `Szenario ${model} gibt es in ${root} nicht` };
            },
          },
        ],
        () => FAKE_CLI_VERSION,
      ),
  };
}

function failure(task: HarnessTask, started: number, log: string[], message: string): HarnessResult {
  return {
    outcome: { kind: "harness_error", message },
    rawResponse: null,
    log: [...log, message].join("\n"),
    tokens: null,
    webSearches: null,
    effort: { reported: null, confirmed: false },
    nativeCostUsd: null,
    durationMs: Date.now() - started,
    exitCode: 1,
    cliVersion: FAKE_CLI_VERSION,
    modelReported: task.model,
  };
}
