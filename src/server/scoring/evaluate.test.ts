import { describe, expect, test } from "vitest";
import type { Mode } from "@/server/prompt/benchmark-prompt";
import type { Assignment, UnitAnswer } from "@/server/prompt/output-schema";
import { evaluateRun } from "./evaluate";
import type { GoldIndustry, GoldUnit, ScoringInput, ScoringUnit, UnitOutcome } from "./model";

// Seam 2: die Bewertung als reine Funktion, viele kleine Fälle ohne Datenbank.

const TEXT =
  "All aspects of civil aviation, including safety, infrastructure, labor, commerce, and international issues.";

const UNIT: ScoringUnit = {
  unitId: "u1",
  unitName: "Subcommittee on Aviation",
  kind: "subcommittee",
  inputBasis: "jurisdiction_text",
  jurisdictionText: TEXT,
};

const TAXONOMY = ["a", "b", "c", "d", "e", "f", "g"];

/** Zuordnung mit wörtlicher, ausreichend langer Evidence. */
function assignment(industry_id: string, evidence_excerpt = "civil aviation"): Assignment {
  return { industry_id, evidence_excerpt, rationale_short: "Begründung." };
}

function answer(assignments: Assignment[], overrides: Partial<UnitAnswer> = {}): UnitAnswer {
  return {
    unit_id: "u1",
    decision: assignments.length > 0 ? "mapped" : "no_mapping",
    no_mapping_reason: assignments.length > 0 ? null : "Keine Industry.",
    broad_scope_exception: false,
    broad_scope_reason: null,
    assignments,
    sources: [],
    label_uncertain: false,
    uncertainty_note: null,
    ...overrides,
  };
}

function mapped(ids: string[]): UnitOutcome {
  return { kind: "answer", answer: answer(ids.map((id) => assignment(id))) };
}

function gold(industries: Partial<GoldIndustry>[], overrides: Partial<GoldUnit> = {}): GoldUnit {
  return {
    unitId: "u1",
    category: "a",
    noMapping: industries.length === 0,
    industries: industries.map((entry) => ({
      industryId: "a",
      class: "positiv",
      webOnly: false,
      ...entry,
    })),
    ...overrides,
  };
}

function input(
  goldUnits: GoldUnit[],
  outcomes: Record<string, UnitOutcome>,
  options: { mode?: Mode; units?: ScoringUnit[] } & Partial<ScoringInput> = {},
): ScoringInput {
  const { mode = "text_only", units, ...rest } = options;
  return {
    mode,
    gold: { version: "gold-test", units: goldUnits },
    outcomes: new Map(Object.entries(outcomes)),
    units: units ?? goldUnits.map((unit) => ({ ...UNIT, unitId: unit.unitId })),
    industryIds: TAXONOMY,
    ...rest,
  };
}

/** Bewertet eine einzelne Unit und liefert ihre Unit-Bewertung. */
function evaluateUnit(goldUnit: GoldUnit, outcome: UnitOutcome, options: Parameters<typeof input>[2] = {}) {
  const [unit] = evaluateRun(input([goldUnit], { [goldUnit.unitId]: outcome }, options)).units;
  return unit;
}

const AB_POSITIV_C_VERTRETBAR = gold([
  { industryId: "a" },
  { industryId: "b" },
  { industryId: "c", class: "vertretbar" },
]);

describe("Unit-Score: F1 aus Recall auf positiv und Präzision auf positiv ∪ vertretbar", () => {
  test.each([
    { name: "alle positiven genannt", ids: ["a", "b"], score: 1 },
    { name: "vertretbare werden nicht bestraft", ids: ["a", "b", "c"], score: 1 },
    { name: "halber Recall, volle Präzision", ids: ["a"], score: 2 / 3 },
    { name: "eine falsche neben einer richtigen", ids: ["a", "d"], score: 0.5 },
    { name: "halber Recall, halbe Präzision", ids: ["a", "c", "d", "e"], score: (2 * 0.5 * 0.5) / 1 },
    { name: "nur vertretbar genannt", ids: ["c"], score: 0 },
    { name: "nur falsche genannt", ids: ["d"], score: 0 },
    { name: "no_mapping statt Industries", ids: [], score: 0 },
    { name: "doppelte Nennung zählt einmal", ids: ["a", "a", "b"], score: 1 },
  ])("$name → $score", ({ ids, score }) => {
    expect(evaluateUnit(AB_POSITIV_C_VERTRETBAR, mapped(ids)).score).toBeCloseTo(score, 10);
  });

  test("no_mapping-Unit: 1 bei no_mapping, sonst 0", () => {
    const noMapping = gold([], { category: "c" });
    expect(evaluateUnit(noMapping, mapped([])).score).toBe(1);
    expect(evaluateUnit(noMapping, mapped(["a"])).score).toBe(0);
  });

  test.each([
    "invalid_json",
    "schema_violation",
    "timeout",
  ] as const)("Format-Fehler (%s) ergibt Unit-Score 0", (errorKind) => {
    const unit = evaluateUnit(AB_POSITIV_C_VERTRETBAR, { kind: "failed", errorKind });
    expect(unit).toMatchObject({ status: "format_error", errorKind, score: 0, named: [] });
    expect(evaluateUnit(gold([]), { kind: "failed", errorKind }).score).toBe(0);
  });
});

describe("web_only je Modus", () => {
  const A_WEB_ONLY_B_POSITIV = gold([{ industryId: "a", webOnly: true }, { industryId: "b" }]);

  test.each([
    { mode: "text_only", ids: ["b"], score: 1 },
    { mode: "text_only", ids: ["a", "b"], score: 1 },
    { mode: "text_only", ids: ["a"], score: 0 },
    { mode: "web", ids: ["b"], score: 2 / 3 },
    { mode: "web", ids: ["a", "b"], score: 1 },
  ] as const)("ohne Web zählt web_only als vertretbar: $mode $ids → $score", ({ mode, ids, score }) => {
    expect(evaluateUnit(A_WEB_ONLY_B_POSITIV, mapped([...ids]), { mode }).score).toBeCloseTo(score, 10);
  });

  const ALLE_POSITIVEN_WEB_ONLY = gold([
    { industryId: "a", webOnly: true },
    { industryId: "b", webOnly: true },
    { industryId: "c", class: "vertretbar" },
  ]);

  test.each([
    { mode: "text_only", ids: [], score: 1 },
    { mode: "text_only", ids: ["a"], score: 1 },
    { mode: "text_only", ids: ["a", "c"], score: 1 },
    { mode: "text_only", ids: ["a", "d"], score: 0.5 },
    { mode: "text_only", ids: ["d"], score: 0 },
    { mode: "web", ids: [], score: 0 },
    { mode: "web", ids: ["a"], score: 2 / 3 },
    { mode: "web", ids: ["a", "b"], score: 1 },
  ] as const)("alle positiven web_only: ohne Web ist auch no_mapping richtig; $mode $ids → $score", ({
    mode,
    ids,
    score,
  }) => {
    expect(evaluateUnit(ALLE_POSITIVEN_WEB_ONLY, mapped([...ids]), { mode }).score).toBeCloseTo(score, 10);
  });

  test("vertretbare web_only-Industries bleiben in beiden Modi vertretbar", () => {
    const unit = gold([{ industryId: "a" }, { industryId: "c", class: "vertretbar", webOnly: true }]);
    for (const mode of ["text_only", "web"] as const) {
      expect(evaluateUnit(unit, mapped(["a", "c"]), { mode }).score).toBe(1);
      expect(evaluateUnit(unit, mapped(["c"]), { mode }).score).toBe(0);
    }
  });
});

describe("Evidence-Prüfung", () => {
  const JEC: ScoringUnit = {
    unitId: "u1",
    unitName: "Joint Economic Committee",
    kind: "committee_direct",
    inputBasis: "jurisdiction_text",
    jurisdictionText:
      "Matters relating to the “Economic Report” of the President’s Council,\n  including   employment.",
  };
  const NAME_ONLY: ScoringUnit = {
    unitId: "u1",
    unitName: "Subcommittee on Rail Safety",
    kind: "subcommittee",
    inputBasis: "name_only",
    jurisdictionText: null,
  };

  function evidenceOf(excerpt: string, options: { mode?: Mode; unit?: ScoringUnit } = {}) {
    const { mode = "text_only", unit = JEC } = options;
    const result = evaluateUnit(
      gold([{ industryId: "a" }]),
      { kind: "answer", answer: answer([assignment("a", excerpt)]) },
      { mode, units: [unit] },
    );
    return { kinds: result.violations.map((violation) => violation.kind), evidence: result.evidence };
  }

  test.each([
    { name: "wörtlich aus dem Zuständigkeitstext", excerpt: "Matters relating to the" },
    { name: "wörtlich aus dem Namen der Unit", excerpt: "Joint Economic Committee" },
    { name: "gerade statt typografische Anführungszeichen", excerpt: 'the "Economic Report" of the' },
    { name: "gerader statt typografischer Apostroph", excerpt: "President's Council" },
    { name: "Zeilenumbruch und mehrfacher Leerraum", excerpt: "Council, including employment" },
    { name: "Leerraum am Rand und im Zitat", excerpt: "  of the   President’s\tCouncil " },
    { name: "zwei Wörter in Anführungszeichen", excerpt: "“Economic Report”" },
  ])("wörtlich: $name", ({ excerpt }) => {
    expect(evidenceOf(excerpt)).toEqual({ kinds: [], evidence: { checked: 1, verbatim: 1 } });
  });

  test("typografische Anführungszeichen im Zitat passen auf gerade im Text", () => {
    const unit = { ...JEC, jurisdictionText: 'the "Economic Report" and the President\'s Council' };
    expect(evidenceOf("the „Economic Report“ and the President‘s Council", { unit }).kinds).toEqual([]);
  });

  test.each([
    { name: "Paraphrase", excerpt: "matters concerning the Economic Report" },
    { name: "aus zwei Stellen zusammengesetzt", excerpt: "Economic Report including employment" },
    { name: "Groß-/Kleinschreibung zählt", excerpt: "matters relating to the" },
    { name: "aus der Taxonomie statt aus der Quelle", excerpt: "Banks Regional" },
  ])("nicht wörtlich: $name", ({ excerpt }) => {
    expect(evidenceOf(excerpt)).toEqual({
      kinds: ["evidence_not_verbatim"],
      evidence: { checked: 1, verbatim: 0 },
    });
  });

  test.each([
    { excerpt: "employment", kinds: ["evidence_too_short"], verbatim: 1 },
    { excerpt: "  “Economic  ", kinds: ["evidence_too_short"], verbatim: 1 },
    { excerpt: "the “", kinds: ["evidence_too_short"], verbatim: 1 },
    { excerpt: "banking", kinds: ["evidence_not_verbatim", "evidence_too_short"], verbatim: 0 },
    { excerpt: "", kinds: ["evidence_not_verbatim", "evidence_too_short"], verbatim: 0 },
  ])("mindestens zwei Wörter: „$excerpt“ → $kinds", ({ excerpt, kinds, verbatim }) => {
    expect(evidenceOf(excerpt)).toEqual({ kinds, evidence: { checked: 1, verbatim } });
  });

  test("name_only: nur der Name der Unit ist Quelle", () => {
    expect(evidenceOf("Rail Safety", { unit: NAME_ONLY }).kinds).toEqual([]);
    expect(evidenceOf("Matters relating to the", { unit: NAME_ONLY }).kinds).toEqual([
      "evidence_not_verbatim",
    ]);
  });

  test("Recherche ist nur im Modus mit Web zulässig und zählt nicht als Zitat", () => {
    expect(evidenceOf("Recherche", { mode: "web" })).toEqual({
      kinds: [],
      evidence: { checked: 0, verbatim: 0 },
    });
    expect(evidenceOf(" Recherche ", { mode: "web" }).kinds).toEqual([]);
    expect(evidenceOf("Recherche", { mode: "text_only" })).toEqual({
      kinds: ["recherche_without_web"],
      evidence: { checked: 0, verbatim: 0 },
    });
  });

  test("Verstöße nennen die betroffene Zuordnung", () => {
    const result = evaluateUnit(gold([{ industryId: "a" }, { industryId: "b" }]), {
      kind: "answer",
      answer: answer([assignment("a"), assignment("b", "aviation")]),
    });
    expect(result.violations).toEqual([{ kind: "evidence_too_short", assignmentIndex: 1, industryId: "b" }]);
  });

  test("Evidence-Treue eines Laufs ist der Anteil wörtlicher an allen geprüften Zitaten", () => {
    const goldUnits = ["u1", "u2", "u3"].map((unitId) => gold([{ industryId: "a" }], { unitId }));
    const evaluation = evaluateRun(
      input(goldUnits, {
        u1: { kind: "answer", answer: answer([assignment("a"), assignment("b", "civil air travel")]) },
        u2: { kind: "answer", answer: answer([assignment("a", "Recherche")]) },
        u3: { kind: "answer", answer: answer([assignment("a", "Subcommittee on Aviation")]) },
      }),
    );
    expect(evaluation.evidenceFidelity).toBeCloseTo(2 / 3, 10);
    expect(
      evaluateRun(input(goldUnits, { u1: mapped([]), u2: mapped([]), u3: mapped([]) })).evidenceFidelity,
    ).toBe(null);
  });
});
