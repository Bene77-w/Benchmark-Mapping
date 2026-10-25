import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { withInlineSchema } from "@/server/prompt/benchmark-prompt";
import type { HarnessTask } from "./adapter";
import { cliOutcome } from "./cli-fixture";
import { createOpencodeAdapter } from "./opencode";
import { opencodeFixture, opencodeFixtureRunner } from "./opencode-fixture";

const FORMAT = "## Format\n\nNur JSON.";

/**
 * Seam 3: der OpenCode-Adapter gegen aufgezeichnete echte Ausgaben (tests/fixtures/harness/opencode): Stream
 * von `opencode run --format json` und Export der Sitzung. Kein echter CLI-Aufruf.
 */

async function runFixture(name: string, overrides: Partial<HarnessTask> = {}, env = {}) {
  const fixture = await opencodeFixture(name);
  const runner = opencodeFixtureRunner([fixture]);
  const adapter = createOpencodeAdapter({
    runCli: runner,
    env: { OPENCODE_WEBSEARCH_PROVIDER: "exa", ...env },
  });
  const result = await adapter.run({
    unitId: fixture.meta.task.unitId,
    systemPrompt: "System",
    userPrompt: "User",
    outputSchema: { type: "object" },
    formatInstruction: FORMAT,
    model: fixture.meta.task.model,
    effort: fixture.meta.task.effort,
    mode: fixture.meta.task.mode as HarnessTask["mode"],
    timeoutMs: 60_000,
    ...overrides,
  });
  return { result, runner };
}

describe("OpenCode-Adapter: Erfolg", () => {
  test("liest Antwort, Tokens und Kosten aus dem Export und bestätigt die Variante", async () => {
    const { result } = await runFixture("erfolg-text-only");

    expect(result.outcome).toMatchObject({
      kind: "answer",
      answer: { unit_id: "house--ethics", decision: "no_mapping", assignments: [] },
    });
    // Export: input 11304 (ohne Cache), output 124 (ohne Reasoning), reasoning 153.
    expect(result.tokens).toEqual({
      inputTokens: 11304,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 277,
      reasoningTokens: 153,
    });
    expect(result.nativeCostUsd).toBe(0.0018618);
    expect(result.webSearches).toBe(0);
    expect(result.effort).toEqual({ reported: "default", confirmed: true });
    expect(result.modelReported).toBe("deepseek/deepseek-flash");
    expect(result.cliVersion).toBe("2.1.4");
    expect(result.exitCode).toBe(0);
    expect(result.rawResponse).toContain('"unit_id":"house--ethics"');
  });
});

describe("OpenCode-Adapter: Websuche", () => {
  test("zählt abgeschlossene websearch-Aufrufe und Cache-Tokens aus dem Export", async () => {
    // Im Stream fehlt das step_finish des letzten Schritts; der Export enthält alle drei Schritte.
    const { result, runner } = await runFixture("erfolg-websuche");

    expect(result.outcome).toMatchObject({
      kind: "answer",
      answer: { unit_id: "senate--appropriations--department-of-homeland-security", decision: "mapped" },
    });
    expect(result.webSearches).toBe(4);
    expect(result.tokens).toEqual({
      inputTokens: 28856,
      cacheReadTokens: 36224,
      cacheWriteTokens: 0,
      outputTokens: 846 + 6981,
      reasoningTokens: 6981,
    });
    expect(result.nativeCostUsd).toBeCloseTo(0.009133272, 9);
    const config = runner.configs[0];
    expect(config.websearch).toEqual({ provider: "exa" });
  });

  test("ohne eingerichteten Suchanbieter startet ein Aufruf mit Web nicht", async () => {
    const fixture = await opencodeFixture("erfolg-websuche");
    const runner = opencodeFixtureRunner([fixture]);
    const adapter = createOpencodeAdapter({ runCli: runner, env: {} });
    const result = await adapter.run(task({ mode: "web" }));

    expect(runner.runs).toHaveLength(0);
    expect(result.outcome).toEqual({
      kind: "harness_error",
      message: expect.stringContaining("OPENCODE_WEBSEARCH_PROVIDER"),
    });
  });
});

describe("OpenCode-Adapter: Format-Fehler", () => {
  test("eine schemawidrige Antwort ist schema_violation", async () => {
    const { result } = await runFixture("schemawidrig");
    expect(result.outcome).toEqual({
      kind: "schema_violation",
      message: expect.stringContaining("decision"),
    });
    expect(result.tokens?.inputTokens).toBe(11304);
  });

  test("Text, der kein JSON ist, ist invalid_json; ein umschließender Codeblock wird entfernt", async () => {
    const fixture = await opencodeFixture("erfolg-text-only");
    const prose = {
      ...fixture,
      exported: null,
      outcome: { ...fixture.outcome, stdout: textEvent("Ich denke, keine Zuordnung.") },
    };
    const fenced = {
      ...fixture,
      exported: null,
      outcome: { ...fixture.outcome, stdout: textEvent(`\`\`\`json\n${answerJson()}\n\`\`\``) },
    };
    const adapter = createOpencodeAdapter({ runCli: opencodeFixtureRunner([prose, fenced]), env: {} });

    expect((await adapter.run(task())).outcome.kind).toBe("invalid_json");
    const second = await adapter.run(task());
    expect(second.outcome.kind).toBe("answer");
    // Ohne Export: Text aus dem Stream, Tokens und Variante unbekannt.
    expect(second.tokens).toBeNull();
    expect(second.effort).toEqual({ reported: null, confirmed: false });
  });
});

describe("OpenCode-Adapter: Fehler", () => {
  test("unbekannte Variante ist ein Harness-Fehler mit der Meldung von OpenCode", async () => {
    const { result } = await runFixture("fehler-variante-unbekannt");
    expect(result.outcome).toEqual({
      kind: "harness_error",
      message: expect.stringContaining("Variant unavailable for deepseek/deepseek-flash: gibtsnicht"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.tokens).toBeNull();
    expect(result.effort).toEqual({ reported: "gibtsnicht", confirmed: true });
  });

  test("abgelehnte Anmeldung (HTTP 403) ist ein Harness-Fehler", async () => {
    const { result } = await runFixture("fehler-anmeldung");
    expect(result.outcome).toEqual({
      kind: "harness_error",
      message: expect.stringContaining("HTTP 403"),
    });
  });

  test("HTTP 429 ist ein Ratenlimit", async () => {
    const { result } = await runFixture("ratenlimit");
    expect(result.outcome).toEqual({
      kind: "rate_limit",
      message: expect.stringContaining("Rate limit"),
      resetAt: null,
    });
  });

  test("Timeout ohne Ergebnis ist timeout, die Sitzung wird trotzdem gelöscht", async () => {
    const stdout = (await opencodeFixture("erfolg-text-only")).outcome.stdout.split("\n")[0];
    const runner = opencodeFixtureRunner([
      { outcome: cliOutcome({ stdout, timedOut: true, exitCode: null, durationMs: 1000 }), exported: null },
    ]);
    const adapter = createOpencodeAdapter({ runCli: runner, env: {} });
    const result = await adapter.run(task({ timeoutMs: 1000 }));

    expect(result.outcome).toEqual({ kind: "timeout", message: "Kein Ergebnis innerhalb von 1000 ms" });
    expect(sessionCalls(runner)).toEqual([
      ["export", "ses_000000"],
      ["delete", "ses_000000"],
    ]);
  });

  test("nicht startbare CLI ist ein Harness-Fehler", async () => {
    const runner = opencodeFixtureRunner([
      {
        outcome: cliOutcome({ exitCode: null, spawnError: "opencode konnte nicht gestartet werden: ENOENT" }),
        exported: null,
      },
    ]);
    const adapter = createOpencodeAdapter({ runCli: runner, env: {} });
    const result = await adapter.run(task());
    expect(result.outcome).toEqual({
      kind: "harness_error",
      message: "opencode konnte nicht gestartet werden: ENOENT",
    });
  });
});

describe("OpenCode-Adapter: Isolation und Sitzung", () => {
  test("ruft opencode isoliert auf, exportiert und löscht die Sitzung und entfernt das temporäre Verzeichnis", async () => {
    const fixture = await opencodeFixture("erfolg-text-only");
    const replay = opencodeFixtureRunner([fixture]);
    const seen: { workdir?: string[]; home?: string[]; config?: string[] } = {};
    const adapter = createOpencodeAdapter({
      runCli: async (invocation) => {
        if (invocation.args[0] === "run") {
          seen.workdir = await readdir(invocation.cwd);
          seen.home = await readdir(invocation.env.HOME ?? "");
          seen.config = await readdir(path.join(invocation.env.XDG_CONFIG_HOME ?? "", "opencode"));
        }
        return replay(invocation);
      },
      env: {
        HOME: "/home/x",
        PATH: "/usr/bin",
        XDG_CONFIG_HOME: "/home/x/.config",
        DATABASE_URL: "postgres://geheim",
        DEEPSEEK_API_KEY: "sk-geheim",
        EXA_API_KEY: "exa-schluessel",
        OPENCODE_DATA_HOME: "/home/x/daten",
      },
    });
    const result = await adapter.run(
      task({
        systemPrompt: "Vertrag",
        userPrompt: "Daten der Unit",
        effort: "high",
        formatInstruction: "## Ausgabeformat\n\nNur ein JSON-Objekt.",
      }),
    );

    const [call] = replay.runs;
    expect(call.command).toBe("opencode");
    expect(call.stdin).toBe("Daten der Unit");
    expect(call.args.slice(0, 6)).toEqual([
      "run",
      "--standalone",
      "--format",
      "json",
      "--agent",
      "benchmark",
    ]);
    expect(flag(call.args, "-m")).toBe("deepseek/deepseek-flash#high");
    expect(flag(call.args, "--title")).toMatch(/^benchmark-mapping-[0-9a-f]{12}$/);
    expect(seen.workdir).toEqual([]);
    expect(seen.home).toEqual([]);
    expect(seen.config).toEqual(["opencode.json"]);
    // Umgebung: Grundvariablen, Suchschlüssel, temporäre XDG-Verzeichnisse; Datenverzeichnis des Nutzers.
    expect(Object.keys(call.env).sort()).toEqual([
      "EXA_API_KEY",
      "HOME",
      "PATH",
      "TMPDIR",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
    ]);
    expect(call.env.XDG_DATA_HOME).toBe("/home/x/daten");
    expect(call.env.HOME).not.toBe("/home/x");
    // Konfiguration: eigener Agent mit Benchmark-Prompt + Schema, alles verboten, keine Websuche.
    const config = replay.configs[0];
    expect(config.websearch).toBe(false);
    expect(config.permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }]);
    const agent = (config.agents as Record<string, { system: string; permissions: unknown }>).benchmark;
    // Der versionierte Formatierungsauftrag der Aufgabe, so wie ihn auch der Unit-Hash abdeckt.
    expect(agent.system).toBe(
      withInlineSchema("Vertrag", "## Ausgabeformat\n\nNur ein JSON-Objekt.", { type: "object" }),
    );
    expect(agent.permissions).toEqual(config.permissions);
    // Sitzung exportiert und gelöscht, alles Temporäre weg.
    expect(sessionCalls(replay)).toEqual([
      ["export", "ses_000000"],
      ["delete", "ses_000000"],
    ]);
    expect(result.log).toContain("Sitzung ses_000000 gelöscht");
    expect(existsSync(path.dirname(call.cwd))).toBe(false);
  });

  test("ohne Formatierungsauftrag startet kein Aufruf (der Unit-Hash träfe den gesendeten Text nicht)", async () => {
    const replay = opencodeFixtureRunner([]);
    const adapter = createOpencodeAdapter({ runCli: replay, env: {} });
    const result = await adapter.run(task({ formatInstruction: undefined }));
    expect(result.outcome.kind).toBe("harness_error");
    expect(replay.runs).toEqual([]);
  });

  test("schickt das Ausgabeschema im System-Prompt mit und sagt das dem Runner", () => {
    expect(createOpencodeAdapter({ env: {} }).inlinesOutputSchema).toBe(true);
  });

  test("im Modus mit Web ist nur websearch erlaubt", async () => {
    const { runner } = await runFixture("erfolg-websuche");
    expect(runner.configs[0].permissions).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "websearch", resource: "*", effect: "allow" },
    ]);
  });

  test("Effort default ruft ohne Variante auf", async () => {
    const { runner } = await runFixture("erfolg-text-only");
    expect(flag(runner.runs[0].args, "-m")).toBe("deepseek/deepseek-flash");
  });

  test("scheitert das Löschen der Sitzung, steht das im Protokoll", async () => {
    const fixture = await opencodeFixture("erfolg-text-only");
    const runner = opencodeFixtureRunner([fixture], {
      deleteOutcome: cliOutcome({ exitCode: 1, stderr: "database is locked" }),
    });
    const result = await createOpencodeAdapter({ runCli: runner, env: {} }).run(task());
    expect(result.outcome.kind).toBe("answer");
    expect(result.log).toContain("session delete ses_000000 scheiterte (Exit-Code 1): database is locked");
  });

  test("ohne Sitzungs-ID im Stream wird die Sitzung über den Titel gefunden und gelöscht", async () => {
    const runner = opencodeFixtureRunner([{ outcome: cliOutcome({ exitCode: 1 }), exported: null }], {
      listSessions: (title) =>
        `ses_verwaist\t${title}\t10/24/2026, 3:58:42 PM\nses_fremd\tandere\t10/24/2026\n`,
    });
    await createOpencodeAdapter({ runCli: runner, env: {} }).run(task());
    expect(sessionCalls(runner)).toEqual([["list"], ["export", "ses_verwaist"], ["delete", "ses_verwaist"]]);
  });
});

function task(overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    unitId: "house--ethics",
    systemPrompt: "System",
    userPrompt: "User",
    outputSchema: { type: "object" },
    formatInstruction: FORMAT,
    model: "deepseek/deepseek-flash",
    effort: "default",
    mode: "text_only",
    timeoutMs: 60_000,
    ...overrides,
  };
}

function textEvent(text: string): string {
  return `${JSON.stringify({ type: "text", sessionID: "ses_000000", part: { type: "text", text } })}\n`;
}

function answerJson(): string {
  return JSON.stringify({
    unit_id: "house--ethics",
    decision: "no_mapping",
    no_mapping_reason: "keine",
    broad_scope_exception: false,
    broad_scope_reason: null,
    assignments: [],
    sources: [],
    label_uncertain: false,
    uncertainty_note: null,
  });
}

function sessionCalls(runner: { calls: Array<{ args: string[] }> }): string[][] {
  return runner.calls
    .filter((call) => call.args[0] === "session")
    .map((call) => call.args.slice(1).filter((arg) => arg !== "--standalone"));
}

function flag(args: string[], name: string): string | undefined {
  return args[args.indexOf(name) + 1];
}
