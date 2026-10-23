import type { SnapshotUnit } from "@/server/snapshot/model";
import { readCorpus, type SourceUnit } from "./corpus";
import { readTaxonomy } from "./taxonomy";

export interface ImportOptions {
  /** Wurzel des Congress Trackers (wird nur gelesen). */
  sourceRoot: string;
  register: readonly unknown[];
}

export async function importSnapshot(options: ImportOptions) {
  const corpus = await readCorpus(options.sourceRoot);
  const taxonomy = await readTaxonomy(options.sourceRoot);
  const units = withParentContext(corpus.units.map(toSnapshotUnit));
  return {
    source: {
      system: "congress_tracker" as const,
      corpusManifestSha256: corpus.manifestSha256,
      taxonomySnapshotId: taxonomy.snapshotId,
      taxonomyContentHash: taxonomy.contentHash,
      yfinanceVersion: taxonomy.yfinanceVersion,
    },
    units,
    industries: taxonomy.industries,
  };
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

/** Subcommittees erhalten den (bereinigten) Zuständigkeitstext ihres Committees als Kontext. */
function withParentContext(units: SnapshotUnit[]): SnapshotUnit[] {
  const textById = new Map(units.map((unit) => [unit.unitId, unit.jurisdictionText]));
  return units.map((unit) => {
    if (unit.parentUnitId === null) return unit;
    const parentText = textById.get(unit.parentUnitId);
    if (parentText === undefined)
      throw new Error(`Unit ${unit.unitId}: Committee ${unit.parentUnitId} fehlt`);
    return { ...unit, parentContextText: parentText };
  });
}
