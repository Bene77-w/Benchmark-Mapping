import type { Database } from "@/server/db/database";
import type { GoldVersion } from "@/server/scoring/model";
import { toScoringGold } from "./model";
import { getGoldVersion, getLatestGoldVersion, listGoldVersions } from "./store";
import { readTestGold } from "./test-gold";

/**
 * Gold-Version, gegen die Läufe bewertet werden: die neueste eingefrorene Gold-Version. Ist
 * `TEST_GOLD_PATH` gesetzt (Playwright, Tests), gilt stattdessen das Test-Gold aus dieser Datei, damit
 * GUI-Tests nicht vom Gold-Stand der Datenbank abhängen. `null`, solange es keine Gold-Version gibt.
 */
export async function getActiveGold(db: Database): Promise<GoldVersion | null> {
  const testGoldPath = process.env.TEST_GOLD_PATH;
  if (testGoldPath) return readTestGold(testGoldPath);
  const latest = await getLatestGoldVersion(db);
  return latest ? toScoringGold(latest) : null;
}

/** Wie `getActiveGold`, aber ohne Gold-Version ein Fehler (zum Starten von Läufen). */
export async function requireActiveGold(db: Database): Promise<GoldVersion> {
  const gold = await getActiveGold(db);
  if (!gold) throw new Error("Noch keine Gold-Version: zuerst unter „Gold“ die Gold-Review abschließen");
  return gold;
}

/** Eine Gold-Version, über deren Units ein Lauf starten kann. */
export interface StartableGold {
  version: string;
  unitCount: number;
}

/**
 * Gold-Versionen, die beim Laufstart zur Wahl stehen: alle eingefrorenen, neueste zuerst (mit `TEST_GOLD_PATH`
 * nur das Test-Gold).
 */
export async function listStartableGold(db: Database): Promise<StartableGold[]> {
  const testGoldPath = process.env.TEST_GOLD_PATH;
  if (testGoldPath) {
    const gold = await readTestGold(testGoldPath);
    return [{ version: gold.version, unitCount: gold.units.length }];
  }
  const labels = (await listGoldVersions(db)).flatMap((version) => (version.label ? [version.label] : []));
  const versions = await Promise.all(labels.map((label) => getGoldVersion(db, label)));
  return versions.flatMap((view) =>
    view?.label ? [{ version: view.label, unitCount: view.units.length }] : [],
  );
}

/**
 * Gold-Version für einen neuen Lauf: die gewählte (`version`) oder ohne Wahl die neueste. Eine unbekannte
 * Version ist ein Fehler.
 */
export async function requireGold(db: Database, version?: string | null): Promise<GoldVersion> {
  if (!version) return requireActiveGold(db);
  const testGoldPath = process.env.TEST_GOLD_PATH;
  if (testGoldPath) {
    const gold = await readTestGold(testGoldPath);
    if (gold.version === version) return gold;
  } else {
    const view = await getGoldVersion(db, version);
    if (view) return toScoringGold(view);
  }
  throw new Error(`Gold-Version ${version} gibt es nicht`);
}
