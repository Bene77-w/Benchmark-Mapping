/**
 * Textbegriffe des Congress Trackers (committee_matcher), nachgebaut für den einmaligen Import.
 * Abweichungen würden die Paritätsprüfung über den mapping-input-v1-Hash brechen.
 */

const chars = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, offset) => from + offset);

// Zeichen, die Pythons str.split() ohne Argument als Leerraum behandelt.
const PYTHON_WHITESPACE = new Set(
  chars(
    ...range(0x09, 0x0d),
    ...range(0x1c, 0x20),
    0x85,
    0xa0,
    0x1680,
    ...range(0x2000, 0x200a),
    0x2028,
    0x2029,
    0x202f,
    0x205f,
    0x3000,
  ),
);

/** `normalize_text`: NFKC, vereinheitlichte Zeilenenden, Leerraumläufe zu einem Leerzeichen. */
export function normalizeText(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").normalize("NFKC");
  const words: string[] = [];
  let current = "";
  for (const char of normalized) {
    if (PYTHON_WHITESPACE.has(char)) {
      if (current) words.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) words.push(current);
  return words.join(" ");
}

const OFFICE_PREFIXES = [
  "permanent select committee on ",
  "select committee on ",
  "joint committee of congress on ",
  "joint committee on ",
  "permanent subcommittee on ",
  "subcommittee on ",
  "committee on ",
];

// Typografische Zeichen, die vor dem Slug vereinheitlicht werden (Gedankenstriche, Anführungszeichen,
// geschützte Leerzeichen).
const TYPOGRAPHY: ReadonlyArray<[string, string]> = [
  [chars(0x2013), "-"],
  [chars(0x2014), "-"],
  [chars(0x2011), "-"],
  [chars(0x2212), "-"],
  [chars(0x2018), "'"],
  [chars(0x2019), "'"],
  [chars(0x201c), '"'],
  [chars(0x201d), '"'],
  [chars(0x00a0), " "],
  [chars(0x202f), " "],
];

function stripOfficePrefix(name: string): string {
  let result = name.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const lowered = result.toLowerCase();
    for (const prefix of OFFICE_PREFIXES) {
      if (lowered.startsWith(prefix)) {
        result = result.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }
  if (result.toLowerCase().startsWith("the ")) result = result.slice(4).trim();
  return result;
}

/** Slug nach `unit-id-v1`. */
export function slugify(name: string): string {
  let text = name.normalize("NFKC");
  for (const [source, target] of TYPOGRAPHY) text = text.replaceAll(source, target);
  text = text.replaceAll("&", " and ");
  text = stripOfficePrefix(text);
  const stripped = text.normalize("NFKD").replace(/\p{M}/gu, "");
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
