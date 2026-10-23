import { createHash } from "node:crypto";

/**
 * Kanonisches JSON: Objektschlüssel rekursiv sortiert, keine Leerzeichen, Nicht-ASCII unverändert.
 * Entspricht `json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))` in Python,
 * damit Hashes des Congress Trackers nachgerechnet werden können.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortKeys(entry)]));
  }
  return value;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
