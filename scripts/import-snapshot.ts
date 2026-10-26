/**
 * Einmaliger Snapshot-Import aus dem Congress Tracker (nur lesend).
 *
 *   pnpm snapshot:import [Pfad zum Congress Tracker]
 *
 * Ohne Argument gilt CONGRESS_TRACKER_ROOT bzw. der lokale Standardpfad. Schreibt data/snapshot/snapshot.json.
 */
import path from "node:path";
import { SNAPSHOT_PATH, writeSnapshotFile } from "@/server/snapshot/snapshot-file";
import { readCleanupRegister } from "@/server/snapshot-import/cleanup-register";
import { importSnapshot } from "@/server/snapshot-import/import-snapshot";

const DEFAULT_SOURCE = "/home/bene/Nextcloud/Projekte/bmb_trdprg/congress_tracker";
const REGISTER_PATH = "data/snapshot/cleanup-register.json";

const sourceRoot = path.resolve(process.argv[2] ?? process.env.CONGRESS_TRACKER_ROOT ?? DEFAULT_SOURCE);
const register = await readCleanupRegister(REGISTER_PATH);
const snapshot = await importSnapshot({ sourceRoot, register });
await writeSnapshotFile(SNAPSHOT_PATH, snapshot);

const nameOnly = snapshot.units.filter((unit) => unit.inputBasis === "name_only").length;
console.log(`Snapshot ${snapshot.version} geschrieben: ${SNAPSHOT_PATH}`);
console.log(`  Content-Hash: ${snapshot.contentHash}`);
console.log(
  `  ${snapshot.units.length} Units (${nameOnly} name_only), ${snapshot.industries.length} Industries, ${snapshot.cleanups.length} Bereinigungen`,
);
