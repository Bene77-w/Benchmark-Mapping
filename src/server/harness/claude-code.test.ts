import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import type { HarnessTask } from "./adapter";
import { createClaudeCodeAdapter } from "./claude-code";
import { readClaudeOutput } from "./claude-code-output";
import { cliOutcome, readCliFixture, scriptedRunner } from "./cli-fixture";
import type { CliInvocation } from "./cli-process";

/**
 * Seam 3: der Claude-Code-Adapter gegen aufgezeichnete echte Ausgaben (tests/fixtures/harness/claude-code).
 * Kein echter CLI-Aufruf; der Adapter bekommt die Aufnahme über einen abgespielten CliRunner.
 */

async function runFixture(name: string, overrides: Partial<HarnessTask> = {}) {
  const { meta, outcome } = await readCliFixture("claude-code", name);
  const runner = scriptedRunner(outcome);
  const adapter = createClaudeCodeAdapter({ runCli: runner, env: {} });
  const result = await adapter.run({
    unitId: meta.task.unitId,
    systemPrompt: "System",
    userPrompt: "User",
    outputSchema: { type: "object" },
    model: meta.task.model,
    effort: meta.task.effort,
    mode: meta.task.mode as HarnessTask["mode"],
    timeoutMs: 60_000,
    ...overrides,
  });
  return { result, runner };
}

describe("Claude-Code-Adapter: Erfolg", () => {
  test("liest die strukturierte Antwort, Tokens aus modelUsage, Kosten und Metadaten", async () => {
    const { result } = await runFixture("erfolg-text-only");

    expect(result.outcome).toMatchObject({
      kind: "answer",
      answer: { unit_id: "house--ethics", decision: "no_mapping", assignments: [] },
    });
    expect(result.tokens).toEqual({
      inputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 20420,
      outputTokens: 734,
      reasoningTokens: 303,
    });
    expect(result.webSearches).toBe(0);
    expect(result.nativeCostUsd).toBe(0.0044512);
    expect(result.cliVersion).toBe("2.1.310");
    expect(result.modelReported).toBe("claude-haiku-5-5");
    expect(result.exitCode).toBe(0);
    expect(result.rawResponse).toContain('"unit_id":"house--ethics"');
  });
});

describe("Claude-Code-Adapter: Websuche", () => {
  test("zählt Websuchen und Tokens aus modelUsage, nicht aus dem obersten usage", async () => {
    // Das oberste usage meldet hier 4 Input-, 5384 Output-Tokens und 0 Websuchen (nur Hauptschleife).
    const { result } = await runFixture("erfolg-websuche");

    expect(result.outcome).toMatchObject({
      kind: "answer",
      answer: { unit_id: "senate--appropriations--department-of-homeland-security", decision: "mapped" },
    });
    expect(result.webSearches).toBe(2);
    expect(result.tokens).toEqual({
      inputTokens: 25489,
      cacheReadTokens: 26985,
      cacheWriteTokens: 18573,
      outputTokens: 7177,
      reasoningTokens: 4700,
    });
    expect(result.nativeCostUsd).toBe(0.03012185);
  });
});

describe("Claude-Code-Adapter: Fehler", () => {
  test("unbekanntes Modell ist ein Harness-Fehler mit der Meldung der CLI", async () => {
    const { result } = await runFixture("fehler-modell-unbekannt");

    expect(result.outcome.kind).toBe("harness_error");
    expect(result.outcome).toMatchObject({
      message: expect.stringContaining("There's an issue with the selected model (claude-gibtsnicht-9)"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.tokens).toBeNull();
    expect(result.nativeCostUsd).toBe(0);
    expect(result.log).toContain("[claude-code:unrecognized_model]");
  });

  test("Ratenlimit wird als rate_limit mit Freigabezeitpunkt aus dem rate_limit_event gemeldet", async () => {
    const { result } = await runFixture("ratenlimit");

    expect(result.outcome).toEqual({
      kind: "rate_limit",
      message: expect.stringContaining("You've hit your limit"),
      resetAt: new Date(1792807200 * 1000),
    });
  });
});

describe("Claude-Code-Adapter: Timeout und Startfehler", () => {
  test("Timeout ohne Ergebnis ist timeout", async () => {
    const adapter = createClaudeCodeAdapter({
      runCli: scriptedRunner(cliOutcome({ timedOut: true, exitCode: null, durationMs: 1000 })),
      env: {},
    });
    const result = await adapter.run(task({ timeoutMs: 1000 }));
    expect(result.outcome).toEqual({ kind: "timeout", message: "Kein Ergebnis innerhalb von 1000 ms" });
    expect(result.tokens).toBeNull();
  });

  test("Timeout, während die CLI ein 429 wiederholt, ist ein Ratenlimit", async () => {
    const adapter = createClaudeCodeAdapter({
      runCli: scriptedRunner(
        cliOutcome({ timedOut: true, exitCode: null, stderr: "API Error: 429 rate_limit_error, retrying" }),
      ),
      env: {},
    });
    const result = await adapter.run(task());
    expect(result.outcome.kind).toBe("rate_limit");
  });

  test("nicht startbare CLI ist ein Harness-Fehler", async () => {
    const adapter = createClaudeCodeAdapter({
      runCli: scriptedRunner(
        cliOutcome({ exitCode: null, spawnError: "claude konnte nicht gestartet werden: ENOENT" }),
      ),
      env: {},
    });
    const result = await adapter.run(task());
    expect(result.outcome).toEqual({
      kind: "harness_error",
      message: "claude konnte nicht gestartet werden: ENOENT",
    });
  });
});

describe("Claude-Code-Adapter: Isolation", () => {
  test("ruft claude ohne Nutzerkonfiguration, MCP-Server und Datei-/Bash-Werkzeuge in einem leeren Verzeichnis auf", async () => {
    const { outcome } = await readCliFixture("claude-code", "erfolg-text-only");
    let workdirWasEmpty = false;
    const calls: CliInvocation[] = [];
    const adapter = createClaudeCodeAdapter({
      runCli: async (invocation) => {
        calls.push(invocation);
        workdirWasEmpty = (await readdir(invocation.cwd)).length === 0;
        return outcome;
      },
      env: {
        HOME: "/home/x",
        PATH: "/usr/bin",
        DATABASE_URL: "postgres://geheim",
        ANTHROPIC_BASE_URL: "http://x",
      },
    });
    await adapter.run(task({ unitId: "house--ethics", mode: "text_only", userPrompt: "Daten der Unit" }));

    const [call] = calls;
    expect(call.command).toBe("claude");
    expect(call.stdin).toBe("Daten der Unit");
    expect(call.args).toEqual(
      expect.arrayContaining(["-p", "--safe-mode", "--strict-mcp-config", "--no-session-persistence"]),
    );
    expect(call.args).not.toContain("--mcp-config");
    expect(flag(call.args, "--tools")).toBe("");
    expect(flag(call.args, "--system-prompt")).toBe("System");
    expect(flag(call.args, "--model")).toBe("haiku");
    expect(flag(call.args, "--effort")).toBe("low");
    expect(flag(call.args, "--output-format")).toBe("json");
    expect(JSON.parse(flag(call.args, "--json-schema") ?? "")).toEqual({ type: "object" });
    expect(workdirWasEmpty).toBe(true);
    expect(existsSync(call.cwd)).toBe(false);
    expect(call.env).toEqual({ HOME: "/home/x", PATH: "/usr/bin" });
  });

  test("im Modus mit Web stehen nur WebSearch und WebFetch zur Verfügung", async () => {
    const runner = scriptedRunner((await readCliFixture("claude-code", "web-ohne-suche")).outcome);
    await createClaudeCodeAdapter({ runCli: runner, env: {} }).run(task({ mode: "web" }));
    expect(flag(runner.calls[0].args, "--tools")).toBe("WebSearch,WebFetch");
  });

  test("die aufgezeichneten Läufe hatten keine MCP-Server und nur die erlaubten Werkzeuge", async () => {
    const textOnly = readClaudeOutput(
      (await readCliFixture("claude-code", "erfolg-text-only")).outcome.stdout,
      "x",
    );
    const web = readClaudeOutput(
      (await readCliFixture("claude-code", "erfolg-websuche")).outcome.stdout,
      "x",
    );
    expect(textOnly.init).toEqual({ tools: ["StructuredOutput"], mcpServers: [] });
    expect(web.init).toEqual({ tools: ["StructuredOutput", "WebFetch", "WebSearch"], mcpServers: [] });
  });
});

describe("Claude-Code-Ausgabe: konstruierte Sonderfälle", () => {
  /** Ein einzelnes `result`-Objekt mit dem angegebenen `modelUsage`. */
  function resultWith(modelUsage: Record<string, unknown>): string {
    return JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "{}",
      modelUsage,
    });
  }

  test("ohne Websuchzähler in modelUsage ist die Zahl der Websuchen unbekannt, nicht 0", () => {
    const output = readClaudeOutput(
      resultWith({ "claude-haiku-5-5": { inputTokens: 5, outputTokens: 2 } }),
      "house--ethics",
    );
    expect(output.tokens).not.toBeNull();
    expect(output.webSearches).toBeNull();
  });
});

function task(overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    unitId: "house--ethics",
    systemPrompt: "System",
    userPrompt: "User",
    outputSchema: { type: "object" },
    model: "haiku",
    effort: "low",
    mode: "text_only",
    timeoutMs: 60_000,
    ...overrides,
  };
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

test("ein abgebrochener Aufruf ist ein Harness-Fehler, das Signal geht an den Prozessstart", async () => {
  const controller = new AbortController();
  const runner = scriptedRunner(cliOutcome({ exitCode: null, aborted: true }));
  const result = await createClaudeCodeAdapter({ runCli: runner, env: {} }).run(
    task({ signal: controller.signal }),
  );
  expect(runner.calls[0].signal).toBe(controller.signal);
  expect(result.outcome).toEqual({ kind: "harness_error", message: "Aufruf abgebrochen" });
});
