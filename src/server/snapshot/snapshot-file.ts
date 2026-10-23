import { readFile, writeFile } from "node:fs/promises";
import { hashCanonical } from "./hash";
import { type Snapshot, type SnapshotContent, snapshotSchema } from "./model";

/** Snapshot-Datei im Repo, die die Laufzeit liest. */
export const SNAPSHOT_PATH = "data/snapshot/snapshot.json";

/** Content-Hash: SHA-256 über den kanonischen Inhalt ohne das Feld `contentHash`. */
export function withContentHash(content: SnapshotContent): Snapshot {
  return { ...content, contentHash: hashCanonical(content) };
}

/** Liest und prüft einen Snapshot; ein Inhalt, der nicht zu seinem Hash passt, ist ein Fehler. */
export async function readSnapshotFile(file: string): Promise<Snapshot> {
  const snapshot = snapshotSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const { contentHash, ...content } = snapshot;
  const actual = hashCanonical(content);
  if (actual !== contentHash) {
    throw new Error(`Snapshot ${file}: Content-Hash ${actual} weicht vom gespeicherten ${contentHash} ab`);
  }
  return snapshot;
}

export async function writeSnapshotFile(file: string, snapshot: Snapshot): Promise<void> {
  await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}
