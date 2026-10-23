import type { SnapshotUnit } from "@/server/snapshot/model";
import { readCorpus, type SourceUnit } from "./corpus";

export interface ImportOptions {
  /** Wurzel des Congress Trackers (wird nur gelesen). */
  sourceRoot: string;
  register: readonly unknown[];
}

export async function importSnapshot(options: ImportOptions) {
  const corpus = await readCorpus(options.sourceRoot);
  const units = corpus.units.map(toSnapshotUnit);
  return { units };
}

function toSnapshotUnit(unit: SourceUnit): SnapshotUnit {
  return {
    unitId: unit.unitId,
    kind: unit.kind,
    chamber: unit.chamber,
    committeeName: unit.committeeName,
    unitName: unit.unitName,
    parentUnitId: unit.parentUnitId,
    parentCommitteeName: unit.parentCommitteeName,
    parentContextText: null,
    inputBasis: unit.inputBasis,
    jurisdictionText: unit.inputBasis === "name_only" ? null : unit.evidenceText,
    sourcePath: unit.sourcePath,
    sourceInputHash: unit.sourceInputHash,
  };
}
