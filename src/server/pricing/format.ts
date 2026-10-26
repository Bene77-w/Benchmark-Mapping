/** Anzeige von Beträgen in USD: unter 1 $ mit vier, sonst mit zwei Nachkommastellen. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  return `$${usd.toFixed(Math.abs(usd) < 1 ? 4 : 2)}`;
}

/** Preis pro Million Tokens bzw. pro Suche, ohne unnötige Nullen; `null` = kein Tarif. */
export function formatPrice(usd: number | null): string {
  return usd === null ? "–" : `$${usd}`;
}
