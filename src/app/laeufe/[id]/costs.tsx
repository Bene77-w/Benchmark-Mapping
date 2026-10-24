import Link from "next/link";
import type { CostEstimate, RunCosts } from "@/server/pricing/cost";
import { formatUsd } from "@/server/pricing/format";

/** Kennzeichnung aller geschätzten Kosten. */
export const ESTIMATE_NOTE = "geschätzt zum API-Listenpreis";

/** Geschätzte und native Kosten eines Laufs nebeneinander. */
export function RunCostSummary({ costs, model }: { costs: RunCosts; model: string }) {
  const { estimated, native } = costs;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">Kosten</h2>
      <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Geschätzte Kosten ({ESTIMATE_NOTE})</dt>
          <dd className="text-xl font-semibold" data-testid="run-cost-estimated">
            {estimated.kind === "estimated" ? formatUsd(estimated.usd) : "unbekannt"}
          </dd>
          {estimated.kind === "unknown" && (
            <dd className="text-muted-foreground" data-testid="run-cost-unknown">
              {estimated.unknownUnits} Unit(s) ohne Schätzung ({estimated.reasons.join("; ")}); bekannt{" "}
              {formatUsd(estimated.knownUsd)}.{" "}
              <Link href={`/modelle?${new URLSearchParams({ modell: model })}`} className="underline">
                Preis pflegen
              </Link>
            </dd>
          )}
        </div>
        <div>
          <dt className="text-muted-foreground">Native Kosten laut Harness (Gegenprobe)</dt>
          <dd className="text-xl font-semibold" data-testid="run-cost-native">
            {native.usd === null ? "–" : formatUsd(native.usd)}
          </dd>
          {native.usd !== null && native.unitsWithout > 0 && (
            <dd className="text-muted-foreground">{native.unitsWithout} Unit(s) ohne Angabe</dd>
          )}
        </div>
      </dl>
    </section>
  );
}

export function unitCostLabel(cost: CostEstimate | null | undefined): string {
  if (!cost) return "–";
  return cost.kind === "estimated" ? formatUsd(cost.usd) : "unbekannt";
}

export function nativeCostLabel(usd: number | null): string {
  return usd === null ? "–" : formatUsd(usd);
}
