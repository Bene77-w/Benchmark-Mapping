import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cliOutcome } from "./cli-fixture";
import { createCodexAdapter } from "./codex";
import { type CodexFixture, codexFixture, codexFixtureRunner, fakeAuthHome } from "./codex-fixture";

/**
 * Preflight des Codex-Adapters (Seam 3): `codex --version`, Anmeldung vorhanden, ein kleiner Probeaufruf mit
 * Modell, Effort und Websuche der Konfiguration; aus dessen Rollout-Log kommen `plan_type`, der angewendete
 * Effort und die Isolation. Die Probe-Ausgaben sind die aufgezeichneten Fixtures.
 */

const version = { outcome: cliOutcome({ stdout: "codex-cli 0.163.0\n" }), lastMessage: null, rollout: null };

let authHome = "";
beforeAll(async () => {
  authHome = await fakeAuthHome();
});
afterAll(async () => {
  await rm(authHome, { recursive: true, force: true });
});

function preflight(...fixtures: Array<Pick<CodexFixture, "outcome" | "lastMessage" | "rollout">>) {
  const runner = codexFixtureRunner(...fixtures);
  return { runner, adapter: createCodexAdapter({ runCli: runner, env: {}, authHome }) };
}

const ids = (result: Awaited<ReturnType<NonNullable<ReturnType<typeof createCodexAdapter>["preflight"]>>>) =>
  result.checks.map((check) => [check.id, check.status]);

describe("Codex-Preflight", () => {
  test("besteht ohne Web mit Version, Anmeldung, Modell, plan_type plus, bestätigtem Effort und Isolation", async () => {
    const { adapter, runner } = preflight(version, await codexFixture("erfolg-text-only"));
    const result = await adapter.preflight?.({ model: "gpt-6-luna", effort: "low", mode: "text_only" });
    if (!result) throw new Error("kein Preflight");

    expect(result).toMatchObject({ ok: true, cliVersion: "0.163.0" });
    expect(ids(result)).toEqual([
      ["cli", "ok"],
      ["auth", "ok"],
      ["model", "ok"],
      ["plan_type", "ok"],
      ["effort", "ok"],
      ["isolation", "ok"],
      ["web_search", "skipped"],
    ]);
    expect(result.checks.find((check) => check.id === "plan_type")?.message).toContain("plus");
    expect(runner.calls[0].args).toEqual(["--version"]);
    const probe = runner.calls[1].args;
    expect(probe[probe.indexOf("-m") + 1]).toBe("gpt-6-luna");
    expect(probe).toContain('model_reasoning_effort="low"');
    expect(probe).not.toContain("--output-schema");
  });

  test("scheitert, wenn plan_type nicht plus ist", async () => {
    const fixture = await codexFixture("erfolg-text-only");
    const free = {
      ...fixture,
      rollout: fixture.rollout?.replaceAll('"plan_type":"plus"', '"plan_type":"free"') ?? null,
    };
    const { adapter } = preflight(version, free);
    const result = await adapter.preflight?.({ model: "gpt-6-luna", effort: "low", mode: "text_only" });

    expect(result?.ok).toBe(false);
    expect(result?.checks.find((check) => check.id === "plan_type")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("free"),
    });
  });

  test("scheitert, wenn Codex einen anderen Effort angewendet hat", async () => {
    const { adapter } = preflight(version, await codexFixture("erfolg-text-only"));
    const result = await adapter.preflight?.({ model: "gpt-6-luna", effort: "medium", mode: "text_only" });

    expect(result?.checks.find((check) => check.id === "effort")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("low"),
    });
  });

  test("besteht im Modus mit Web, wenn die Probe eine Websuche ausgeführt hat", async () => {
    const { adapter, runner } = preflight(version, await codexFixture("erfolg-websuche"));
    const result = await adapter.preflight?.({ model: "gpt-6-luna", effort: "low", mode: "web" });

    expect(result?.ok).toBe(true);
    expect(result?.checks.find((check) => check.id === "web_search")).toMatchObject({ status: "ok" });
    expect(runner.calls[1].args).toContain("tools.web_search=true");
  });

  test("scheitert im Modus mit Web, wenn keine Websuche stattfand", async () => {
    const { adapter } = preflight(version, await codexFixture("erfolg-text-only"));
    const result = await adapter.preflight?.({ model: "gpt-6-luna", effort: "low", mode: "web" });

    expect(result?.checks.find((check) => check.id === "web_search")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("keine Websuche"),
    });
  });

  test("scheitert bei unbekanntem Modell mit der Meldung der CLI; spätere Prüfungen entfallen", async () => {
    const { adapter } = preflight(version, await codexFixture("fehler-modell-unbekannt"));
    const result = await adapter.preflight?.({ model: "gpt-gibtsnicht-9", effort: "low", mode: "text_only" });
    if (!result) throw new Error("kein Preflight");

    expect(result.ok).toBe(false);
    expect(ids(result)).toEqual([
      ["cli", "ok"],
      ["auth", "ok"],
      ["model", "failed"],
      ["plan_type", "skipped"],
      ["effort", "skipped"],
      ["isolation", "skipped"],
      ["web_search", "skipped"],
    ]);
    expect(result.checks[2].message).toContain("model is not supported");
  });

  test("scheitert ohne Probeaufruf, wenn die Anmeldung fehlt", async () => {
    const runner = codexFixtureRunner(version);
    const adapter = createCodexAdapter({ runCli: runner, env: {}, authHome: "/gibt/es/nicht" });
    const result = await adapter.preflight?.({ model: "gpt-6-luna", effort: "low", mode: "text_only" });

    expect(result?.checks.find((check) => check.id === "auth")).toMatchObject({
      status: "failed",
      message: expect.stringContaining("/gibt/es/nicht"),
    });
    expect(runner.calls).toHaveLength(1);
  });

  test("scheitert, wenn die CLI nicht startet", async () => {
    const { adapter, runner } = preflight({
      ...version,
      outcome: cliOutcome({ exitCode: null, spawnError: "codex konnte nicht gestartet werden: ENOENT" }),
    });
    const result = await adapter.preflight?.({ model: "gpt-6-luna", effort: "low", mode: "text_only" });

    expect(result?.checks[0]).toMatchObject({ id: "cli", status: "failed" });
    expect(runner.calls).toHaveLength(1);
  });
});
