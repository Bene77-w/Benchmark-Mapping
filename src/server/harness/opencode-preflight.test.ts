import { describe, expect, test } from "vitest";
import { cliOutcome } from "./cli-fixture";
import type { CliEnv } from "./cli-process";
import { createOpencodeAdapter } from "./opencode";
import { type OpencodeReplayOptions, opencodeFixture, opencodeFixtureRunner } from "./opencode-fixture";
import type { PreflightRequest, PreflightResult } from "./preflight";

/**
 * Preflight des OpenCode-Adapters (Seam 3): `opencode --version`, Anmeldung des Providers (`auth list`, nur
 * IDs), bei Modus mit Web ein eingerichteter Suchanbieter, dann eine kleine Probe mit Modell und Variante der
 * Konfiguration; aus deren Sitzungsexport kommen Variante, Agent/Werkzeuge (Isolation) und Websuchen.
 */

type Fixture = Awaited<ReturnType<typeof opencodeFixture>>;

async function preflight(
  request: Partial<PreflightRequest>,
  fixtures: Fixture[],
  { env = {}, ...replay }: OpencodeReplayOptions & { env?: CliEnv } = {},
) {
  const runner = opencodeFixtureRunner(fixtures, { integrations: ["deepseek"], ...replay });
  const adapter = createOpencodeAdapter({ runCli: runner, env });
  const result = await adapter.preflight?.({
    model: "deepseek/deepseek-flash",
    effort: "default",
    mode: "text_only",
    ...request,
  });
  if (!result) throw new Error("kein Preflight");
  return { result, runner };
}

const ids = (result: PreflightResult) => result.checks.map((check) => [check.id, check.status]);
const check = (result: PreflightResult, id: string) => result.checks.find((entry) => entry.id === id);

describe("OpenCode-Preflight", () => {
  test("besteht ohne Web mit Version, Anmeldung, Modell, bestätigter Variante, Isolation und gelöschter Sitzung", async () => {
    const { result, runner } = await preflight({}, [await opencodeFixture("erfolg-text-only")]);

    expect(result).toMatchObject({ ok: true, cliVersion: "2.1.4" });
    expect(ids(result)).toEqual([
      ["cli", "ok"],
      ["auth", "ok"],
      ["search_provider", "skipped"],
      ["model", "ok"],
      ["effort", "ok"],
      ["isolation", "ok"],
      ["session", "ok"],
      ["web_search", "skipped"],
    ]);
    expect(runner.calls[0].args).toEqual(["--version"]);
    expect(runner.calls[1].args).toEqual(["auth", "list", "--standalone", "--format", "json"]);
    // Probe ohne Schema-Anhang.
    const agent = (runner.configs[0].agents as Record<string, { system: string }>).benchmark;
    expect(agent.system).not.toContain("Ausgabeformat");
  });

  test("reicht das Abbruchsignal (Claim-Verlust) an Version, Anmeldung und Probe weiter", async () => {
    const runner = opencodeFixtureRunner([await opencodeFixture("erfolg-text-only")], {
      integrations: ["deepseek"],
    });
    const adapter = createOpencodeAdapter({ runCli: runner, env: {} });
    const { signal } = new AbortController();
    await adapter.preflight?.(
      { model: "deepseek/deepseek-flash", effort: "default", mode: "text_only" },
      { signal },
    );

    const signalOf = (first: string) => runner.calls.find((call) => call.args[0] === first)?.signal;
    expect(signalOf("--version")).toBe(signal);
    expect(signalOf("auth")).toBe(signal);
    expect(signalOf("run")).toBe(signal);
  });

  test("lehnt den Modus mit Web ohne Suchanbieter vor der Probe mit klarer Meldung ab", async () => {
    const { result, runner } = await preflight({ mode: "web" }, [await opencodeFixture("erfolg-websuche")]);

    expect(result.ok).toBe(false);
    expect(check(result, "search_provider")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("kein Suchanbieter eingerichtet: OPENCODE_WEBSEARCH_PROVIDER setzen"),
    });
    expect(check(result, "model")?.status).toBe("skipped");
    expect(runner.runs).toHaveLength(0);
  });

  test("lehnt einen Suchanbieter ohne Schlüssel ab", async () => {
    const { result } = await preflight({ mode: "web" }, [await opencodeFixture("erfolg-websuche")], {
      env: { OPENCODE_WEBSEARCH_PROVIDER: "tavily" },
    });
    expect(check(result, "search_provider")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("TAVILY_API_KEY"),
    });
  });

  test("besteht mit Web, wenn der Suchanbieter eingerichtet ist und die Probe gesucht hat", async () => {
    const { result, runner } = await preflight({ mode: "web" }, [await opencodeFixture("erfolg-websuche")], {
      env: { OPENCODE_WEBSEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "schluessel" },
    });
    expect(result.ok).toBe(true);
    expect(check(result, "search_provider")?.status).toBe("ok");
    expect(check(result, "isolation")?.status).toBe("ok");
    expect(check(result, "web_search")).toMatchObject({
      status: "ok",
      message: expect.stringContaining("4"),
    });
    expect(runner.configs[0].websearch).toEqual({ provider: "tavily" });
  });

  test("scheitert, wenn die Probe trotz Suchanbieter nicht gesucht hat", async () => {
    const { result } = await preflight({ mode: "web" }, [await opencodeFixture("erfolg-text-only")], {
      env: { OPENCODE_WEBSEARCH_PROVIDER: "exa" },
    });
    expect(check(result, "web_search")?.status).toBe("failed");
  });

  test("scheitert ohne Anmeldung für den Provider des Modells", async () => {
    const { result, runner } = await preflight({}, [await opencodeFixture("erfolg-text-only")], {
      integrations: ["openrouter"],
    });
    expect(check(result, "auth")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("deepseek"),
    });
    expect(runner.runs).toHaveLength(0);
  });

  test("scheitert bei unbekannter Variante mit der Meldung von OpenCode", async () => {
    const { result } = await preflight({ effort: "gibtsnicht" }, [
      await opencodeFixture("fehler-variante-unbekannt"),
    ]);
    expect(check(result, "model")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("Variant unavailable"),
    });
  });

  test("scheitert, wenn eine andere Variante angewendet wurde", async () => {
    const { result } = await preflight({ effort: "high" }, [await opencodeFixture("erfolg-text-only")]);
    expect(check(result, "effort")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("default"),
    });
  });

  test("scheitert, wenn die Probe ein Werkzeug benutzt hat (Isolation)", async () => {
    const { result } = await preflight({}, [await opencodeFixture("erfolg-websuche")]);
    expect(check(result, "isolation")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("websearch"),
    });
  });

  test("scheitert, wenn die Sitzung nicht gelöscht werden konnte", async () => {
    const { result } = await preflight({}, [await opencodeFixture("erfolg-text-only")], {
      deleteOutcome: cliOutcome({ exitCode: 1, stderr: "database is locked" }),
    });
    expect(check(result, "session")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("database is locked"),
    });
  });

  test("nicht erreichbare CLI scheitert sofort", async () => {
    const runner = opencodeFixtureRunner([]);
    const adapter = createOpencodeAdapter({
      runCli: async (invocation) =>
        invocation.args[0] === "--version"
          ? cliOutcome({ exitCode: null, spawnError: "opencode konnte nicht gestartet werden: ENOENT" })
          : runner(invocation),
      env: {},
    });
    const result = await adapter.preflight?.({
      model: "deepseek/deepseek-flash",
      effort: "default",
      mode: "text_only",
    });
    expect(result?.checks[0]).toMatchObject({ id: "cli", status: "failed" });
    expect(result?.checks.slice(1).every((entry) => entry.status === "skipped")).toBe(true);
  });
});
