import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { importSnapshot } from "./import-snapshot";

// Ausschnitt des Congress Trackers: drei unverändert kopierte Korpusdateien und die freigegebene Taxonomie.
const FIXTURE_ROOT = fileURLToPath(new URL("../../../tests/fixtures/congress-tracker", import.meta.url));

/** Beschreibbare Kopie der Fixture für Tests, die die Quelle verändern. */
async function copyFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "congress-tracker-"));
  await cp(FIXTURE_ROOT, root, { recursive: true });
  return root;
}

function unitById(snapshot: Awaited<ReturnType<typeof importSnapshot>>, id: string) {
  const unit = snapshot.units.find((candidate) => candidate.unitId === id);
  if (!unit) throw new Error(`Unit ${id} fehlt im Snapshot`);
  return unit;
}

describe("importSnapshot", () => {
  test("liest Units so wie der Congress Tracker (gleicher mapping-input-v1-Hash)", async () => {
    const snapshot = await importSnapshot({ sourceRoot: FIXTURE_ROOT, register: [] });

    // Referenzwerte aus map-fullrun-20261016/reviewed_assignments.csv des Congress Trackers.
    expect(unitById(snapshot, "senate--finance").sourceInputHash).toBe(
      "def7bcbd1f360143495322959ea32a3d6de8477291af9e8e90b1fe81123fec7c",
    );
    expect(unitById(snapshot, "senate--finance--health-care").sourceInputHash).toBe(
      "964d49f098c5a442280a1e5c84b0cd3697282182c38b2dd20c278db639a2469a",
    );
    expect(unitById(snapshot, "house--veterans-affairs--health").sourceInputHash).toBe(
      "b6dd9cc2c68e54257f42b4b4e4a5a63f5d7a2aa9e400936fd301058070595de6",
    );
    expect(unitById(snapshot, "joint--taxation").sourceInputHash).toBe(
      "9046f6d2b59fea7b3f2c7c41a0bf457f38f8bba709b81ed4734ed6b8d35883e2",
    );
  });

  test("übernimmt die 145 Industries der freigegebenen Taxonomie mit Sektor und Beschreibung", async () => {
    const snapshot = await importSnapshot({ sourceRoot: FIXTURE_ROOT, register: [] });

    expect(snapshot.industries).toHaveLength(145);
    expect(snapshot.industries.find((industry) => industry.industryId === "airlines")).toEqual({
      industryId: "airlines",
      industryName: "Airlines",
      sectorId: "industrials",
      sectorName: "Industrials",
      description:
        "Major international passenger airline companies that fly a wide range of domestic and international routes.",
    });
    expect(snapshot.source.taxonomyContentHash).toBe(
      "8c3da76572d994be167115502e646785f97c299d43244bc161468457b5ffbb6f",
    );
  });

  test("bricht ab, wenn die Taxonomie nicht zu ihrem Content-Hash passt", async () => {
    const root = await copyFixture();
    const file = path.join(root, "data/committee_matcher_v2/taxonomy/approved_baseline.json");
    const taxonomy = JSON.parse(await readFile(file, "utf8"));
    taxonomy.industries[0].description = "verändert";
    await writeFile(file, JSON.stringify(taxonomy));

    await expect(importSnapshot({ sourceRoot: root, register: [] })).rejects.toThrow(/Content-Hash/);
  });

  test("gibt Subcommittees den Zuständigkeitstext des übergeordneten Committees als Kontext mit", async () => {
    const snapshot = await importSnapshot({ sourceRoot: FIXTURE_ROOT, register: [] });

    const core = unitById(snapshot, "senate--finance");
    const health = unitById(snapshot, "senate--finance--health-care");
    expect(core.kind).toBe("committee_parent_core");
    expect(core.parentContextText).toBeNull();
    expect(health).toMatchObject({
      kind: "subcommittee",
      chamber: "senate",
      committeeName: "Committee on Finance",
      unitName: "Subcommittee on Health Care",
      parentUnitId: "senate--finance",
      parentCommitteeName: "Committee on Finance",
      inputBasis: "name_only",
      jurisdictionText: null,
    });
    expect(health.parentContextText).toMatch(/^1\. Bonded debt of the United States/);
    expect(health.parentContextText).toBe(core.jurisdictionText);
    expect(unitById(snapshot, "joint--taxation")).toMatchObject({
      kind: "committee_direct",
      parentUnitId: null,
      parentContextText: null,
    });
  });
});
