/**
 * Evidence-Prüfung: Ein Zitat ist wörtlich, wenn es nach Normalisierung von Leerraum und typografischen
 * Anführungszeichen im Namen der Unit oder im Zuständigkeitstext vorkommt; es braucht mindestens zwei Wörter.
 * Groß-/Kleinschreibung und alle anderen Zeichen bleiben unverändert. `Recherche` ist kein Zitat.
 */

export const RECHERCHE = "Recherche";

const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const SINGLE_QUOTES = /[‘’‚‛′‹›]/g;

export function normalizeEvidence(text: string): string {
  return text.replace(DOUBLE_QUOTES, '"').replace(SINGLE_QUOTES, "'").replace(/\s+/g, " ").trim();
}

export function isRecherche(excerpt: string): boolean {
  return excerpt.trim() === RECHERCHE;
}

/** Wörter = durch Leerraum getrennte Teile mit mindestens einem Buchstaben oder einer Ziffer. */
export function wordCount(excerpt: string): number {
  return normalizeEvidence(excerpt)
    .split(" ")
    .filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

/** Wörtlich in einer der Quellen (Name der Unit, Zuständigkeitstext)? Ein leeres Zitat ist es nie. */
export function isVerbatim(excerpt: string, sources: readonly (string | null)[]): boolean {
  const needle = normalizeEvidence(excerpt);
  if (needle === "") return false;
  return sources.some((source) => source !== null && normalizeEvidence(source).includes(needle));
}
