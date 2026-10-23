import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { HarnessTask } from "./adapter";
import { createFakeAdapter, FAKE_HARNESS_ROOT } from "./fake";

function task(overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    unitId: "house--ethics",
    systemPrompt: "System",
    userPrompt: "User",
    outputSchema: {},
    model: "standard",
    effort: "high",
    mode: "text_only",
    timeoutMs: 60_000,
    ...overrides,
  };
}

const validAnswer = {
  unit_id: "u1",
  decision: "no_mapping",
  no_mapping_reason: "Keine Industry.",
  broad_scope_exception: false,
  broad_scope_reason: null,
  assignments: [],
  sources: [],
  label_uncertain: false,
  uncertainty_note: null,
};

/** Legt ein Szenario mit einer vorbereiteten Antwort für Unit `u1` an. */
async function scenario(file: unknown): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "fake-harness-"));
  await mkdir(path.join(root, "szenario"));
  await writeFile(path.join(root, "szenario", "u1.json"), JSON.stringify(file));
  return root;
}

describe("Fake-Harness", () => {
  test("liefert die vorbereitete Antwort samt Tokens, Kosten und Metadaten aus dem Szenario-Verzeichnis", async () => {
    const adapter = createFakeAdapter({ root: FAKE_HARNESS_ROOT });

    const result = await adapter.run(task({ unitId: "house--ethics", model: "standard", effort: "high" }));

    expect(result.outcome).toEqual({
      kind: "answer",
      answer: expect.objectContaining({ unit_id: "house--ethics", decision: "no_mapping", assignments: [] }),
    });
    expect(JSON.parse(result.rawResponse ?? "")).toMatchObject({ unit_id: "house--ethics" });
    expect(result.tokens).toEqual({
      inputTokens: 3900,
      cacheReadTokens: 31000,
      cacheWriteTokens: 0,
      outputTokens: 180,
      reasoningTokens: 60,
    });
    expect(result.webSearches).toBe(0);
    expect(result.nativeCostUsd).toBe(0.0071);
    expect(result.effort).toEqual({ reported: "high", confirmed: true });
    expect(result.modelReported).toBe("standard");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(400);
    expect(result.log).toContain("house--ethics");
  });

  test("ein Antworttext, der kein JSON ist, wird zum Format-Fehler invalid_json", async () => {
    const root = await scenario({ response: "Ich denke, es ist Banking." });
    const result = await createFakeAdapter({ root }).run(task({ unitId: "u1", model: "szenario" }));

    expect(result.outcome.kind).toBe("invalid_json");
    expect(result.rawResponse).toBe("Ich denke, es ist Banking.");
  });

  test("eine Antwort, die das Ausgabeschema verletzt, wird zum Format-Fehler schema_violation", async () => {
    const { label_uncertain: _dropped, ...incomplete } = validAnswer;
    const root = await scenario({ response: incomplete });
    const result = await createFakeAdapter({ root }).run(task({ unitId: "u1", model: "szenario" }));

    expect(result.outcome).toEqual({
      kind: "schema_violation",
      message: expect.stringContaining("label_uncertain"),
    });
  });

  test("simuliert Timeout und Ratenlimit ohne Antwort", async () => {
    const timeoutRoot = await scenario({ simulate: "timeout" });
    const timeout = await createFakeAdapter({ root: timeoutRoot }).run(
      task({ unitId: "u1", model: "szenario", timeoutMs: 1234 }),
    );
    expect(timeout.outcome.kind).toBe("timeout");
    expect(timeout.rawResponse).toBeNull();
    expect(timeout.durationMs).toBe(1234);

    const limitRoot = await scenario({ simulate: "rate_limit", resetAt: "2026-10-23T12:00:00Z" });
    const limited = await createFakeAdapter({ root: limitRoot }).run(
      task({ unitId: "u1", model: "szenario" }),
    );
    expect(limited.outcome).toEqual({
      kind: "rate_limit",
      message: expect.any(String),
      resetAt: new Date("2026-10-23T12:00:00Z"),
    });
  });

  test("ohne vorbereitete Antwort oder bei ungültigem Szenarionamen meldet er einen Harness-Fehler", async () => {
    const adapter = createFakeAdapter({ root: FAKE_HARNESS_ROOT });

    const missing = await adapter.run(task({ unitId: "gibt-es-nicht", model: "standard" }));
    expect(missing.outcome).toEqual({
      kind: "harness_error",
      message: expect.stringContaining("gibt-es-nicht"),
    });

    const traversal = await adapter.run(task({ unitId: "house--ethics", model: "../standard" }));
    expect(traversal.outcome.kind).toBe("harness_error");
  });
});
