import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashCanonical } from "@/server/snapshot/hash";
import type { Industry } from "@/server/snapshot/model";

/** Freigegebene Taxonomie relativ zur Wurzel des Congress Trackers. */
export const TAXONOMY_FILE = "data/committee_matcher_v2/taxonomy/approved_baseline.json";
const CONTENT_VERSION = "taxonomy-content-v1";

const sourceIndustrySchema = z.strictObject({
  industry_id: z.string().trim().min(1),
  industry_name: z.string().trim().min(1),
  sector_id: z.string().trim().min(1),
  sector_name: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

const baselineSchema = z.object({
  content_version: z.literal(CONTENT_VERSION),
  approved_run_id: z.string().min(1),
  taxonomy_content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  yfinance_version: z.string().min(1),
  industries: z.array(sourceIndustrySchema).min(1),
});

export interface Taxonomy {
  snapshotId: string;
  contentHash: string;
  yfinanceVersion: string;
  industries: Industry[];
}

/** Liest die freigegebene Taxonomie und prüft ihren `taxonomy-content-v1`-Hash. */
export async function readTaxonomy(sourceRoot: string): Promise<Taxonomy> {
  const raw = JSON.parse(await readFile(path.join(sourceRoot, TAXONOMY_FILE), "utf8"));
  const baseline = baselineSchema.parse(raw);
  const records = [...baseline.industries].sort((a, b) => (a.industry_id < b.industry_id ? -1 : 1));
  for (let index = 1; index < records.length; index++) {
    if (records[index].industry_id === records[index - 1].industry_id) {
      throw new Error(`Taxonomie: industry_id ${records[index].industry_id} doppelt`);
    }
  }
  const actualHash = hashCanonical({ version: CONTENT_VERSION, industries: records });
  if (actualHash !== baseline.taxonomy_content_hash) {
    throw new Error(
      `Taxonomie: Content-Hash ${actualHash} weicht vom freigegebenen ${baseline.taxonomy_content_hash} ab`,
    );
  }
  return {
    snapshotId: baseline.approved_run_id,
    contentHash: baseline.taxonomy_content_hash,
    yfinanceVersion: baseline.yfinance_version,
    industries: records.map((record) => ({
      industryId: record.industry_id,
      industryName: record.industry_name,
      sectorId: record.sector_id,
      sectorName: record.sector_name,
      description: record.description,
    })),
  };
}
