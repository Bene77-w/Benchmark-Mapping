import type { Database } from "@/server/db/database";
import type { GoldVersion } from "@/server/scoring/model";
import { toScoringGold } from "./model";
import { getLatestGoldVersion } from "./store";
import { readTestGold } from "./test-gold";

/**
 * Gold-Version, gegen die Läufe laufen und bewertet werden: die neueste eingefrorene Gold-Version. Ist
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
