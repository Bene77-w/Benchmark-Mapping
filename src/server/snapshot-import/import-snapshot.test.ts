import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { importSnapshot } from "./import-snapshot";

// Ausschnitt des Congress Trackers: drei unverändert kopierte Korpusdateien und die freigegebene Taxonomie.
const FIXTURE_ROOT = fileURLToPath(new URL("../../../tests/fixtures/congress-tracker", import.meta.url));

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
});
