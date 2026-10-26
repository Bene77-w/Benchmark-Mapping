import { existsSync } from "node:fs";
import { lstat, readdir, readFile, readlink, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { HarnessTask } from "./adapter";
import { cliOutcome, scriptedRunner } from "./cli-fixture";
import { createCodexAdapter } from "./codex";
import { codexFixture, codexFixtureRunner, fakeAuthHome } from "./codex-fixture";

/**
 * Seam 3: der Codex-Adapter gegen aufgezeichnete echte Ausgaben (tests/fixtures/harness/codex). Kein echter
 * CLI-Aufruf; der abgespielte Runner schreibt Antwortdatei und Rollout-Log der Aufnahme dorthin, wohin die
 * echte CLI sie schreiben würde (`--output-last-message`, `$CODEX_HOME/sessions`).
 */

let authHome = "";
beforeAll(async () => {
  authHome = await fakeAuthHome();
});
afterAll(async () => {
  await rm(authHome, { recursive: true, force: true });
});

async function runFixture(name: string, overrides: Partial<HarnessTask> = {}) {
  const fixture = await codexFixture(name);
  const runner = codexFixtureRunner(fixture);
  const adapter = createCodexAdapter({ runCli: runner, env: {}, authHome });
  const result = await adapter.run({
    unitId: fixture.meta.task.unitId,
    systemPrompt: "System",
    userPrompt: "User",
    outputSchema: { type: "object" },
    model: fixture.meta.task.model,
    effort: fixture.meta.task.effort,
    mode: fixture.meta.task.mode as HarnessTask["mode"],
    timeoutMs: 60_000,
    ...overrides,
  });
  return { result, runner };
}

describe("Codex-Adapter: Erfolg", () => {
  test("liest die Antwort aus der Abschlussdatei, Tokens aus turn.completed und Effort aus dem Rollout", async () => {
    const { result } = await runFixture("erfolg-text-only");

    expect(result.outcome).toMatchObject({
      kind: "answer",
      answer: { unit_id: "house--ethics", decision: "no_mapping", assignments: [] },
    });
    expect(result.tokens).toEqual({
      inputTokens: 22225,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 108,
      reasoningTokens: 0,
    });
    expect(result.webSearches).toBe(0);
    expect(result.effort).toEqual({ reported: "low", confirmed: true });
    expect(result.nativeCostUsd).toBeNull();
    expect(result.cliVersion).toBe("0.163.0");
    expect(result.modelReported).toBe("gpt-6-luna");
    expect(result.exitCode).toBe(0);
    expect(result.rawResponse).toContain('"unit_id":"house--ethics"');
  });
});

describe("Codex-Adapter: Websuche", () => {
  test("zählt web_search-Items und rechnet gecachte Tokens aus input_tokens heraus", async () => {
    // turn.completed: input_tokens 47408, davon cached_input_tokens 21376.
    const { result, runner } = await runFixture("erfolg-websuche");

    expect(result.outcome).toMatchObject({
      kind: "answer",
      answer: {
        unit_id: "senate--appropriations--department-of-homeland-security",
        decision: "no_mapping",
        sources: [{ url: "https://www.appropriations.senate.gov/subcommittees/homeland-security" }],
      },
    });
    expect(result.webSearches).toBe(1);
    expect(result.tokens).toEqual({
      inputTokens: 26032,
      cacheReadTokens: 21376,
      cacheWriteTokens: 0,
      outputTokens: 289,
      reasoningTokens: 0,
    });
    expect(flag(runner.calls[0].args, "-c", "tools.web_search=")).toBe("tools.web_search=true");
  });
});

describe("Codex-Adapter: Fehler", () => {
  test("unbekanntes Modell ist ein Harness-Fehler mit der Meldung aus turn.failed", async () => {
    const { result } = await runFixture("fehler-modell-unbekannt");

    expect(result.outcome.kind).toBe("harness_error");
    expect(result.outcome).toMatchObject({
      message: expect.stringContaining("The 'gpt-gibtsnicht-9' model is not supported"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.tokens).toBeNull();
    expect(result.rawResponse).toBeNull();
    expect(result.modelReported).toBe("gpt-gibtsnicht-9");
  });

  test("Ratenlimit wird als rate_limit mit Freigabezeitpunkt des erschöpften Fensters gemeldet", async () => {
    const { result } = await runFixture("ratenlimit");

    expect(result.outcome).toEqual({
      kind: "rate_limit",
      message: expect.stringContaining("You've hit your usage limit"),
      resetAt: new Date(1792837472 * 1000),
    });
    expect(result.log).toContain("plan_type plus");
  });
});

describe("Codex-Adapter: Effort-Bestätigung", () => {
  test("weicht der angewendete Effort ab, ist er unbestätigt und wird so gemeldet", async () => {
    const { result } = await runFixture("erfolg-text-only", { effort: "high" });
    expect(result.effort).toEqual({ reported: "low", confirmed: false });
  });

  test("ohne Rollout-Log bleibt der Effort unbestätigt, die Antwort zählt trotzdem", async () => {
    const fixture = await codexFixture("erfolg-text-only");
    const adapter = createCodexAdapter({
      runCli: codexFixtureRunner({ ...fixture, rollout: null }),
      env: {},
      authHome,
    });
    const result = await adapter.run(task());
    expect(result.outcome.kind).toBe("answer");
    expect(result.effort).toEqual({ reported: null, confirmed: false });
    expect(result.log).toContain("Effort unbestätigt");
  });
});

describe("Codex-Adapter: Timeout, Startfehler, Anmeldung", () => {
  test("Timeout ohne Ergebnis ist timeout", async () => {
    const adapter = createCodexAdapter({
      runCli: scriptedRunner(cliOutcome({ timedOut: true, exitCode: null, durationMs: 1000 })),
      env: {},
      authHome,
    });
    const result = await adapter.run(task({ timeoutMs: 1000 }));
    expect(result.outcome).toEqual({ kind: "timeout", message: "Kein Ergebnis innerhalb von 1000 ms" });
  });

  test("Exit-Code 0 ohne Abschlussdatei ist ein Harness-Fehler", async () => {
    const adapter = createCodexAdapter({ runCli: scriptedRunner(cliOutcome()), env: {}, authHome });
    const result = await adapter.run(task());
    expect(result.outcome.kind).toBe("harness_error");
  });

  test("nicht startbare CLI ist ein Harness-Fehler", async () => {
    const adapter = createCodexAdapter({
      runCli: scriptedRunner(
        cliOutcome({ exitCode: null, spawnError: "codex konnte nicht gestartet werden: ENOENT" }),
      ),
      env: {},
      authHome,
    });
    const result = await adapter.run(task());
    expect(result.outcome).toEqual({
      kind: "harness_error",
      message: "codex konnte nicht gestartet werden: ENOENT",
    });
  });

  test("fehlt die Anmeldung, startet die CLI nicht und der Fehler nennt CODEX_AUTH_HOME", async () => {
    const runner = scriptedRunner(cliOutcome());
    const adapter = createCodexAdapter({ runCli: runner, env: { CODEX_AUTH_HOME: "/gibt/es/nicht" } });
    const result = await adapter.run(task());
    expect(runner.calls).toHaveLength(0);
    expect(result.outcome).toEqual({
      kind: "harness_error",
      message: expect.stringContaining("CODEX_AUTH_HOME"),
    });
  });
});

describe("Codex-Adapter: Isolation und Anmeldung", () => {
  test("verlinkt die Anmeldung nur, ruft codex isoliert auf und entfernt das temporäre Verzeichnis", async () => {
    const fixture = await codexFixture("erfolg-text-only");
    const replay = codexFixtureRunner(fixture);
    const seen: {
      workdirEntries?: string[];
      authLink?: string;
      authIsLink?: boolean;
      homeEntries?: string[];
    } = {};
    const adapter = createCodexAdapter({
      runCli: async (invocation) => {
        seen.workdirEntries = await readdir(invocation.cwd);
        const codexHome = invocation.env.CODEX_HOME ?? "";
        seen.homeEntries = await readdir(codexHome);
        seen.authIsLink = (await lstat(path.join(codexHome, "auth.json"))).isSymbolicLink();
        seen.authLink = await readlink(path.join(codexHome, "auth.json"));
        return replay(invocation);
      },
      env: {
        HOME: "/home/x",
        PATH: "/usr/bin",
        XDG_CONFIG_HOME: "/home/x/.config",
        DATABASE_URL: "postgres://geheim",
        OPENAI_API_KEY: "sk-geheim",
        CODEX_AUTH_HOME: authHome,
      },
    });
    await adapter.run(task({ systemPrompt: "Vertrag", userPrompt: "Daten der Unit" }));

    const [call] = replay.calls;
    expect(call.command).toBe("codex");
    expect(call.stdin).toBe("Vertrag\n\nDaten der Unit");
    expect(call.args.slice(0, 1)).toEqual(["exec"]);
    expect(call.args).toEqual(
      expect.arrayContaining(["--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules"]),
    );
    expect(flag(call.args, "--sandbox")).toBe("read-only");
    expect(flag(call.args, "-m")).toBe("gpt-6-luna");
    expect(flag(call.args, "-C")).toBe(call.cwd);
    expect(flag(call.args, "-c", "model_reasoning_effort=")).toBe('model_reasoning_effort="low"');
    expect(flag(call.args, "-c", "tools.web_search=")).toBe("tools.web_search=false");
    expect(call.args).toEqual(expect.arrayContaining(["--disable", "shell_tool"]));
    expect(call.args.at(-1)).toBe("-");
    expect(seen.workdirEntries).toEqual([]);
    expect(seen.homeEntries).toEqual(["auth.json"]);
    expect(seen.authIsLink).toBe(true);
    expect(seen.authLink).toBe(path.join(authHome, "auth.json"));
    // Umgebung: nur Grundvariablen; HOME und CODEX_HOME zeigen ins temporäre Verzeichnis.
    expect(Object.keys(call.env).sort()).toEqual(["CODEX_HOME", "HOME", "PATH"]);
    expect(call.env.HOME).not.toBe("/home/x");
    // Danach ist alles weg, die Anmeldung selbst ist unverändert.
    expect(existsSync(path.dirname(call.cwd))).toBe(false);
    expect(await readFile(path.join(authHome, "auth.json"), "utf8")).toContain("Platzhalter");
  });

  test("Schema und Antwortdatei liegen im temporären Verzeichnis, nicht im Arbeitsverzeichnis", async () => {
    const { runner } = await runFixture("erfolg-text-only");
    const [call] = runner.calls;
    const root = path.dirname(call.cwd);
    expect(path.dirname(flag(call.args, "--output-schema") ?? "")).toBe(root);
    expect(path.dirname(flag(call.args, "--output-last-message") ?? "")).toBe(root);
  });
});

function task(overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    unitId: "house--ethics",
    systemPrompt: "System",
    userPrompt: "User",
    outputSchema: { type: "object" },
    model: "gpt-6-luna",
    effort: "low",
    mode: "text_only",
    timeoutMs: 60_000,
    ...overrides,
  };
}

/** Wert nach `name`; bei wiederholten Flags (`-c`) der erste, der mit `prefix` beginnt. */
function flag(args: string[], name: string, prefix = ""): string | undefined {
  return args.find((arg, index) => args[index - 1] === name && arg.startsWith(prefix));
}
