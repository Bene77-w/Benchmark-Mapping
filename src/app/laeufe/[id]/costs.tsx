import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type CostEstimate, nativeCostOf, type RunCosts } from "@/server/pricing/cost";
import { formatUsd } from "@/server/pricing/format";

/** Kennzeichnung aller geschätzten Kosten. */
export const ESTIMATE_NOTE = "geschätzt zum API-Listenpreis";

/** Geschätzte und native Kosten eines Laufs nebeneinander. */
export function RunCostSummary({ costs, model }: { costs: RunCosts; model: string }) {
  const { estimated, native } = costs;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Kosten</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-muted/40 px-4 py-3">
            <dt className="text-xs text-muted-foreground">Geschätzte Kosten ({ESTIMATE_NOTE})</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="run-cost-estimated">
              {estimated.kind === "estimated" ? formatUsd(estimated.usd) : "unbekannt"}
            </dd>
            {estimated.kind === "unknown" && (
              <dd className="mt-1 text-xs text-muted-foreground" data-testid="run-cost-unknown">
                {estimated.unknownUnits} Unit(s) ohne Schätzung ({estimated.reasons.join("; ")}); bekannt{" "}
                {formatUsd(estimated.knownUsd)}.{" "}
                <Link
                  href={`/modelle?${new URLSearchParams({ modell: model })}`}
                  className="text-primary hover:underline"
                >
                  Preis pflegen
                </Link>
              </dd>
            )}
          </div>
          <div className="rounded-lg border bg-muted/40 px-4 py-3">
            <dt className="text-xs text-muted-foreground">Native Kosten laut Harness (Gegenprobe)</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="run-cost-native">
              {native.usd === null ? "–" : formatUsd(native.usd)}
            </dd>
            {native.usd !== null && native.unitsWithout > 0 && (
              <dd className="mt-1 text-xs text-muted-foreground">
                {native.unitsWithout} Unit(s) ohne Angabe
              </dd>
            )}
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function unitCostLabel(cost: CostEstimate | null | undefined): string {
  if (!cost) return "–";
  return cost.kind === "estimated" ? formatUsd(cost.usd) : "unbekannt";
}

export function nativeCostLabel(unit: Parameters<typeof nativeCostOf>[0]): string {
  const usd = nativeCostOf(unit);
  return usd === null ? "–" : formatUsd(usd);
}
