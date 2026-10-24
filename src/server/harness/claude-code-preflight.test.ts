import { describe, expect, test } from "vitest";
import { createClaudeCodeAdapter } from "./claude-code";
import { cliOutcome, readCliFixture, scriptedRunner } from "./cli-fixture";

/**
 * Preflight des Claude-Code-Adapters (Seam 3): `claude --version` und ein kleiner Probeaufruf mit Modell,
 * Effort und Werkzeugen der Konfiguration. Die Probe-Ausgaben sind die aufgezeichneten Fixtures.
 */

const version = cliOutcome({ stdout: "2.1.310 (Claude Code)\n" });

async function probe(name: string) {
  return (await readCliFixture("claude-code", name)).outcome;
}

function preflight(...outcomes: Parameters<typeof scriptedRunner>) {
  const runner = scriptedRunner(...outcomes);
  return { runner, adapter: createClaudeCodeAdapter({ runCli: runner, env: {} }) };
}

describe("Claude-Code-Preflight", () => {
  test("besteht im Modus ohne Web mit Version, Modell und Isolation; Websuche entfällt", async () => {
    const { adapter, runner } = preflight(version, await probe("erfolg-text-only"));
    const result = await adapter.preflight?.({ model: "haiku", effort: "low", mode: "text_only" });

    expect(result).toMatchObject({ ok: true, cliVersion: "2.1.310" });
    expect(result?.checks.map((check) => [check.id, check.status])).toEqual([
      ["cli", "ok"],
      ["model", "ok"],
      ["isolation", "ok"],
      ["web_search", "skipped"],
    ]);
    expect(runner.calls[0].args).toEqual(["--version"]);
    const probeArgs = runner.calls[1].args;
    expect(probeArgs[probeArgs.indexOf("--model") + 1]).toBe("haiku");
    expect(probeArgs[probeArgs.indexOf("--effort") + 1]).toBe("low");
    expect(probeArgs[probeArgs.indexOf("--tools") + 1]).toBe("");
  });

  test("besteht im Modus mit Web, wenn die Probe eine Websuche ausgeführt hat", async () => {
    const { adapter, runner } = preflight(version, await probe("erfolg-websuche"));
    const result = await adapter.preflight?.({ model: "haiku", effort: "low", mode: "web" });

    expect(result?.ok).toBe(true);
    expect(result?.checks.find((check) => check.id === "web_search")).toMatchObject({ status: "ok" });
    const probeArgs = runner.calls[1].args;
    expect(probeArgs[probeArgs.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
  });

  test("scheitert im Modus mit Web, wenn keine Websuche stattfand", async () => {
    const { adapter } = preflight(version, await probe("web-ohne-suche"));
    const result = await adapter.preflight?.({ model: "haiku", effort: "low", mode: "web" });

    expect(result?.ok).toBe(false);
    expect(result?.checks.find((check) => check.id === "web_search")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("keine Websuche"),
    });
  });

  test("scheitert bei unbekanntem Modell mit der Meldung der CLI; spätere Prüfungen entfallen", async () => {
    const { adapter } = preflight(version, await probe("fehler-modell-unbekannt"));
    const result = await adapter.preflight?.({ model: "claude-gibtsnicht-9", effort: "low", mode: "web" });

    expect(result?.ok).toBe(false);
    expect(result?.checks.map((check) => [check.id, check.status])).toEqual([
      ["cli", "ok"],
      ["model", "failed"],
      ["isolation", "skipped"],
      ["web_search", "skipped"],
    ]);
    expect(result?.checks[1].message).toContain("There's an issue with the selected model");
  });

  test("scheitert ohne Probeaufruf, wenn die CLI nicht startet", async () => {
    const { adapter, runner } = preflight(
      cliOutcome({ exitCode: null, spawnError: "claude konnte nicht gestartet werden: spawn claude ENOENT" }),
    );
    const result = await adapter.preflight?.({ model: "haiku", effort: "low", mode: "text_only" });

    expect(result).toMatchObject({ ok: false, cliVersion: null });
    expect(result?.checks[0]).toMatchObject({
      id: "cli",
      status: "failed",
      message: expect.stringContaining("ENOENT"),
    });
    expect(runner.calls).toHaveLength(1);
  });

  test("meldet ein Ratenlimit in der Probe als Fehler mit Freigabezeitpunkt", async () => {
    const { adapter } = preflight(version, await probe("ratenlimit"));
    const result = await adapter.preflight?.({ model: "haiku", effort: "low", mode: "text_only" });

    expect(result?.ok).toBe(false);
    expect(result?.checks[1]).toMatchObject({
      status: "failed",
      message: expect.stringContaining("Ratenlimit"),
    });
  });
});
