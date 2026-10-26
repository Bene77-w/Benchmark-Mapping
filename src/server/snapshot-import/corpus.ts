import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { hashCanonical, sha256Hex } from "@/server/snapshot/hash";
import {
  type Chamber,
  chamberSchema,
  type InputBasis,
  inputBasisSchema,
  type UnitKind,
} from "@/server/snapshot/model";
import { normalizeText, slugify } from "./congress-text";

/** Korpus relativ zur Wurzel des Congress Trackers. */
export const CORPUS_DIR = "data/committee_matcher_inputs";
const MANIFEST_FILE = "corpus_manifest.yaml";
const JURISDICTION_HEADING = "Committee jurisdiction";
const COMMENT_HEADING = "Zusätzliche Kommentare";

/** Eine Unit so, wie sie im Korpus steht (unbereinigt, Texte normalisiert). */
export interface SourceUnit {
  unitId: string;
  kind: UnitKind;
  chamber: Chamber;
  committeeName: string;
  unitName: string;
  parentUnitId: string | null;
  parentCommitteeName: string | null;
  inputBasis: InputBasis;
  /** Normalisierter Zuständigkeitstext; leer bei name_only. */
  evidenceText: string;
  sourcePath: string;
  sourceInputHash: string;
}

export interface Corpus {
  manifestSha256: string;
  units: SourceUnit[];
}

const manifestSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      role: z.string(),
      sha256: z.string(),
    }),
  ),
});

const frontmatterSchema = z.object({
  chamber: chamberSchema,
  committee: z.string().trim().min(1),
  unit_input_basis: z.object({
    committee: z.literal("jurisdiction_text"),
    subcommittees: z.record(z.string(), inputBasisSchema).nullish(),
  }),
});

class CorpusError extends Error {
  constructor(file: string, message: string) {
    super(`Korpus ${file}: ${message}`);
    this.name = "CorpusError";
  }
}

/** Liest alle Mapping-Dateien des Korpus und bildet die Units wie `committee_matcher.units.build_units`. */
export async function readCorpus(sourceRoot: string): Promise<Corpus> {
  const corpusRoot = path.join(sourceRoot, CORPUS_DIR);
  const manifestText = await readFile(path.join(corpusRoot, MANIFEST_FILE), "utf8");
  const manifest = manifestSchema.parse(parseYaml(manifestText));
  const mappingFiles = manifest.files
    .filter((file) => file.role === "mapping_input")
    .sort((a, b) => (a.path < b.path ? -1 : 1));

  const units: SourceUnit[] = [];
  for (const file of mappingFiles) {
    const bytes = await readFile(path.join(corpusRoot, file.path));
    if (sha256Hex(bytes) !== file.sha256) {
      throw new CorpusError(file.path, "Inhalt weicht vom Hash im Corpusmanifest ab");
    }
    units.push(...documentUnits(file.path, bytes.toString("utf8")));
  }

  const seen = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.unitId)) throw new CorpusError(unit.sourcePath, `Unit-ID ${unit.unitId} doppelt`);
    seen.add(unit.unitId);
  }
  return { manifestSha256: sha256Hex(manifestText), units };
}

interface Section {
  name: string;
  text: string;
}

function documentUnits(relPath: string, text: string): SourceUnit[] {
  if (!text.startsWith("---\n")) throw new CorpusError(relPath, "Frontmatter fehlt");
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) throw new CorpusError(relPath, "Frontmatter nicht geschlossen");
  const frontmatter = frontmatterSchema.parse(parseYaml(text.slice(4, end + 1)));
  const { preamble, sections } = parseBody(relPath, text.slice(end + 5));

  const chamber = frontmatter.chamber;
  const committee = frontmatter.committee;
  const committeeId = `${chamber}--${slugify(committee)}`;
  const subcommitteeBasis = frontmatter.unit_input_basis.subcommittees ?? {};
  const base = { chamber, committeeName: committee, sourcePath: relPath };

  if (sections.length === 0) {
    return [
      buildUnit({
        ...base,
        unitId: committeeId,
        kind: "committee_direct",
        unitName: committee,
        inputBasis: "jurisdiction_text",
        evidence: preamble,
        parent: null,
      }),
    ];
  }

  const parentContext = normalizeText(preamble);
  return [
    buildUnit({
      ...base,
      unitId: committeeId,
      kind: "committee_parent_core",
      unitName: committee,
      inputBasis: "jurisdiction_text",
      evidence: preamble,
      parent: null,
    }),
    ...sections.map((section) => {
      const basis = subcommitteeBasis[section.name];
      if (!basis) throw new CorpusError(relPath, `kein unit_input_basis-Eintrag für ${section.name}`);
      return buildUnit({
        ...base,
        unitId: `${committeeId}--${slugify(section.name)}`,
        kind: "subcommittee",
        unitName: section.name,
        inputBasis: basis,
        evidence: basis === "name_only" ? "" : section.text,
        parent: { unitId: committeeId, committeeName: committee, contextText: parentContext },
      });
    }),
  ];
}

function parseBody(relPath: string, body: string): { preamble: string; sections: Section[] } {
  const h1s = [...body.matchAll(/^# (.+?)\s*$/gm)];
  if (h1s.length !== 1 || h1s[0][1] !== JURISDICTION_HEADING) {
    throw new CorpusError(relPath, `erwartet genau eine H1 '# ${JURISDICTION_HEADING}'`);
  }
  const h1 = h1s[0];
  const h2s = [...body.matchAll(/^## (.+?)\s*$/gm)];
  const sections: Section[] = [];
  let commentsSeen = false;
  h2s.forEach((match, index) => {
    const name = match[1];
    if (name === COMMENT_HEADING) {
      commentsSeen = true;
      return;
    }
    if (commentsSeen) throw new CorpusError(relPath, `Abschnitt ${name} steht hinter den Kommentaren`);
    const start = match.index + match[0].length;
    const end = index + 1 < h2s.length ? h2s[index + 1].index : body.length;
    sections.push({ name, text: body.slice(start, end) });
  });
  const first = h2s.length > 0 ? h2s[0].index : body.length;
  return { preamble: body.slice(h1.index + h1[0].length, first), sections };
}

interface UnitInput {
  unitId: string;
  kind: UnitKind;
  chamber: Chamber;
  committeeName: string;
  unitName: string;
  inputBasis: InputBasis;
  evidence: string;
  sourcePath: string;
  parent: { unitId: string; committeeName: string; contextText: string } | null;
}

function buildUnit(input: UnitInput): SourceUnit {
  const evidenceText = normalizeText(input.evidence);
  const parentCommitteeName = input.parent?.committeeName ?? null;
  const parentContextText = input.parent?.contextText ?? "";
  // mapping-input-v1 aus committee_matcher/units.py
  const sourceInputHash = hashCanonical({
    version: "mapping-input-v1",
    unit_id: input.unitId,
    kind: input.kind,
    chamber: input.chamber,
    committee_name: normalizeText(input.committeeName),
    unit_name: normalizeText(input.unitName),
    input_basis: input.inputBasis,
    evidence_text: evidenceText,
    parent_committee_name: parentCommitteeName ? normalizeText(parentCommitteeName) : null,
    parent_context_text: normalizeText(parentContextText),
  });
  return {
    unitId: input.unitId,
    kind: input.kind,
    chamber: input.chamber,
    committeeName: input.committeeName,
    unitName: input.unitName,
    parentUnitId: input.parent?.unitId ?? null,
    parentCommitteeName,
    inputBasis: input.inputBasis,
    evidenceText,
    sourcePath: input.sourcePath,
    sourceInputHash,
  };
}
