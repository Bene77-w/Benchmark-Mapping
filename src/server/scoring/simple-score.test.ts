import { describe, expect, test } from "vitest";
import { readTestGold, TEST_GOLD_PATH } from "@/server/gold/test-gold";
import type { UnitAnswer } from "@/server/prompt/output-schema";
import { type SimpleGoldUnit, simpleRunScore, simpleUnitScore } from "./simple-score";

function answer(industryIds: string[]): UnitAnswer {
  return {
    unit_id: "u1",
    decision: industryIds.length > 0 ? "mapped" : "no_mapping",
    no_mapping_reason: industryIds.length > 0 ? null : "Keine Industry.",
    broad_scope_exception: false,
    broad_scope_reason: null,
    assignments: industryIds.map((industry_id) => ({
      industry_id,
      evidence_excerpt: "civil aviation",
      rationale_short: "Begründung.",
    })),
    sources: [],
    label_uncertain: false,
    uncertainty_note: null,
  };
}

const mapped: SimpleGoldUnit = {
  unitId: "u1",
  noMapping: false,
  industries: [
    { industryId: "a", class: "positiv" },
    { industryId: "b", class: "positiv" },
    { industryId: "c", class: "vertretbar" },
  ],
};
const noMapping: SimpleGoldUnit = { unitId: "u1", noMapping: true, industries: [] };

describe("Einfache Bewertung (F1 gegen Test-Gold)", () => {
  test.each([
    { name: "alle positiven genannt", ids: ["a", "b"], score: 1 },
    { name: "vertretbare werden nicht bestraft", ids: ["a", "b", "c"], score: 1 },
    { name: "halber Recall, volle Präzision", ids: ["a"], score: 2 / 3 },
    { name: "eine falsche neben einer richtigen", ids: ["a", "x"], score: 0.5 },
    { name: "nur vertretbar genannt", ids: ["c"], score: 0 },
    { name: "no_mapping statt Industries", ids: [], score: 0 },
    { name: "doppelte Nennung zählt einmal", ids: ["a", "a", "b"], score: 1 },
  ])("Unit mit Industries: $name → $score", ({ ids, score }) => {
    expect(simpleUnitScore(answer(ids), mapped)).toBeCloseTo(score, 10);
  });

  test("no_mapping-Unit: 1 bei no_mapping, sonst 0", () => {
    expect(simpleUnitScore(answer([]), noMapping)).toBe(1);
    expect(simpleUnitScore(answer(["a"]), noMapping)).toBe(0);
  });

  test("ohne verwertbare Antwort (Format-Fehler) ist der Unit-Score 0", () => {
    expect(simpleUnitScore(null, mapped)).toBe(0);
    expect(simpleUnitScore(null, noMapping)).toBe(0);
  });

  test("Lauf-Score ist der Mittelwert über alle Gold-Units; fehlende Antworten zählen 0", () => {
    const gold = [
      { ...mapped, unitId: "u1" },
      { ...noMapping, unitId: "u2" },
      { ...noMapping, unitId: "u3" },
    ];
    const answers = new Map([
      ["u1", answer(["a"])],
      ["u2", answer([])],
    ]);
    expect(simpleRunScore(answers, gold)).toEqual({
      score: (2 / 3 + 1 + 0) / 3,
      unitScores: new Map([
        ["u1", 2 / 3],
        ["u2", 1],
        ["u3", 0],
      ]),
    });
  });

  test("das Test-Gold aus den Fixtures ist lesbar", async () => {
    const gold = await readTestGold(TEST_GOLD_PATH);
    expect(gold.version).toBe("test-gold");
    expect(gold.units.map((unit) => unit.unitId)).toContain("house--ethics");
  });
});
