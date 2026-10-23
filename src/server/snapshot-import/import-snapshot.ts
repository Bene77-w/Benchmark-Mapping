import {
  SNAPSHOT_FORMAT,
  type Snapshot,
  type SnapshotContent,
  type SnapshotUnit,
} from "@/server/snapshot/model";
import { withContentHash } from "@/server/snapshot/snapshot-file";
import { applyCleanups, type CleanupRule } from "./cleanup-register";
import { readCorpus, type SourceUnit } from "./corpus";
import { readTaxonomy } from "./taxonomy";

export interface ImportOptions {
  /** Wurzel des Congress Trackers (wird nur gelesen). */
  sourceRoot: string;
  /** Bereinigungsregister; wird in seiner Reihenfolge angewendet. */
  register: readonly CleanupRule[];
  /** Fachliche Version des Snapshots, Standard `snapshot-v1`. */
  version?: string;
}

/**
 * Einmaliger Import aus dem Congress Tracker: Units und Taxonomie lesen, Bereinigungsregister anwenden,
 * Snapshot mit Content-Hash bilden. Gleiche Quelle und gleiches Register ergeben denselben Hash.
 */
export async function importSnapshot(options: ImportOptions): Promise<Snapshot> {
  const corpus = await readCorpus(options.sourceRoot);
  const taxonomy = await readTaxonomy(options.sourceRoot);
  const cleaned = applyCleanups(corpus.units.map(toSnapshotUnit), options.register);
  const units = withParentContext(cleaned.units);
  const content: SnapshotContent = {
    format: SNAPSHOT_FORMAT,
    version: options.version ?? "snapshot-v1",
    source: {
      system: "congress_tracker",
      corpusManifestSha256: corpus.manifestSha256,
      taxonomySnapshotId: taxonomy.snapshotId,
      taxonomyContentHash: taxonomy.contentHash,
      yfinanceVersion: taxonomy.yfinanceVersion,
    },
    units,
    industries: taxonomy.industries,
    cleanups: cleaned.cleanups,
  };
  return withContentHash(content);
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
