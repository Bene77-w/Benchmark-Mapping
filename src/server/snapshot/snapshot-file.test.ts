import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { readSnapshotFile, SNAPSHOT_PATH } from "./snapshot-file";

describe("eingecheckter Snapshot", () => {
  test("enthält alle 225 Units und 145 Industries und passt zu seinem Content-Hash", async () => {
    const snapshot = await readSnapshotFile(SNAPSHOT_PATH);

    expect(snapshot.version).toBe("snapshot-v1");
    expect(snapshot.units).toHaveLength(225);
    expect(snapshot.industries).toHaveLength(145);
    const kinds = Object.groupBy(snapshot.units, (unit) => unit.kind);
    expect(kinds.subcommittee).toHaveLength(179);
    expect(kinds.committee_parent_core).toHaveLength(31);
    expect(kinds.committee_direct).toHaveLength(15);
  });

  test("zeigt Modellen keine deutschen Kuratorennotizen, keine Silbentrennung und keinen 31-Zeichen-Text", async () => {
    const snapshot = await readSnapshotFile(SNAPSHOT_PATH);

    for (const unit of snapshot.units) {
      for (const text of [unit.jurisdictionText, unit.parentContextText]) {
        expect(text ?? "", unit.unitId).not.toMatch(/Zusatz:|Hinweis:|Pflichten:|überprüft|[äöüß]/);
        expect(text ?? "", unit.unitId).not.toMatch(/\b[A-Za-z]+- [a-z]+\b/);
      }
    }
    const jec = snapshot.units.find((unit) => unit.unitId === "joint--joint-economic-committee");
    expect(jec?.jurisdictionText).toMatch(/^It shall be the function of the joint committee/);
    const dhs = snapshot.units.find(
      (unit) => unit.unitId === "senate--appropriations--department-of-homeland-security",
    );
    expect(dhs?.inputBasis).toBe("name_only");
  });

  test("enthält keine Markdown-Reste der Extraktion, damit zeilenübergreifende Zitate wörtlich bleiben", async () => {
    const snapshot = await readSnapshotFile(SNAPSHOT_PATH);

    for (const unit of snapshot.units) {
      for (const text of [unit.jurisdictionText, unit.parentContextText]) {
        // Überschriften (###), Zitatmarker (>), Listenpunkte (- ), Hervorhebungen, Code und Links.
        expect(text ?? "", unit.unitId).not.toMatch(/#|>|(^|\s)-\s|\*|`|\[|\]|\|/);
      }
    }
    const intelligence = snapshot.units.find((unit) => unit.unitId === "house--intelligence");
    expect(intelligence?.jurisdictionText).toContain(
      "relating to the following: (A) The Central Intelligence Agency",
    );
    const homeland = snapshot.units.find((unit) => unit.unitId === "house--homeland-security");
    expect(homeland?.jurisdictionText).toContain("non-border enforcement). (B) Customs");
  });

  test("lehnt einen Snapshot ab, dessen Inhalt nicht zum Content-Hash passt", async () => {
    const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
    snapshot.units[0].unitName = "verändert";
    const file = path.join(await mkdtemp(path.join(tmpdir(), "snapshot-")), "snapshot.json");
    await writeFile(file, JSON.stringify(snapshot));

    await expect(readSnapshotFile(file)).rejects.toThrow(/Content-Hash/);
  });
});
