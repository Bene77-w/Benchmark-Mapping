import { expect, test } from "vitest";
import { configurationSchema } from "./model";

const base = { harness: "codex", mode: "text_only" } as const;

test("Konfiguration akzeptiert übliche Modell- und Effort-Bezeichner", () => {
  for (const model of [
    "gpt-5.5",
    "anthropic/claude-sonnet-5-5",
    "claude-opus-5-5[1m]",
    "openrouter/x:free",
  ]) {
    expect(configurationSchema.safeParse({ ...base, model, effort: "high" }).success).toBe(true);
  }
});

test("Konfiguration lehnt Sonderzeichen in Modell und Effort ab", () => {
  expect(
    configurationSchema.safeParse({ ...base, model: "gpt-5.5", effort: 'high" sandbox="x' }).success,
  ).toBe(false);
  expect(configurationSchema.safeParse({ ...base, model: "gpt 5; rm", effort: "high" }).success).toBe(false);
});
