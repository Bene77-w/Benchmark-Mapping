import type { FullConfig } from "@playwright/test";

/**
 * Wärmt den Dev-Server vor (läuft nach dem Start der webServer): Next kompiliert jede Seite beim ersten
 * Aufruf; parallel laufende Specs überschreiten mit kaltem Build-Verzeichnis sonst ihre Wartezeiten
 * (z. B. die Weiterleitung auf eine neue Lauf-Seite). Unbekannte IDs genügen, die Seite wird trotzdem gebaut.
 */
const PAGES = [
  "/laeufe",
  "/laeufe/0",
  "/laeufe/0/units/vorwaermen",
  "/auswertung",
  "/prompt",
  "/modelle",
  "/gold",
  "/gold/units/vorwaermen",
  "/gold/versionen/vorwaermen",
];

export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  for (const page of PAGES) {
    await fetch(new URL(page, baseURL)).catch(() => undefined);
  }
}
