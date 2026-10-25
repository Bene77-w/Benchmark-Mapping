import Link from "next/link";
import { Suspense } from "react";
import { buildAnalysis, parseAnalysisParams, xValue } from "@/server/analysis/leaderboard";
import { getDatabase } from "@/server/db/client";
import { getActiveGold } from "@/server/gold/active";
import { HARNESS_LABELS } from "@/server/harness/adapter";
import { getPriceTable } from "@/server/pricing/store";
import type { RunView } from "@/server/runs/model";
import { getRun } from "@/server/runs/store";
import { listCurrentEvaluations } from "@/server/scoring/current";
import { ESTIMATE_NOTE } from "../laeufe/[id]/costs";
import { MODE_LABELS } from "../laeufe/labels";
import { FilterBar } from "./filter-bar";
import { LeaderboardTable } from "./leaderboard-table";
import { ScatterPlot } from "./scatter-plot";

export const metadata = { title: "Auswertung – Benchmark-Mapping" };

export default function AnalysisPage({ searchParams }: PageProps<"/auswertung">) {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Auswertung</h1>
      <Suspense fallback={<p className="text-muted-foreground">Lade Auswertung …</p>}>
        <AnalysisContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AnalysisContent({ searchParams }: Pick<PageProps<"/auswertung">, "searchParams">) {
  const requested = parseAnalysisParams(await searchParams);
  const db = getDatabase();
  const gold = await getActiveGold(db);
  if (!gold) {
    return (
      <p className="text-muted-foreground">
        Noch keine Gold-Version – die Auswertung braucht eine abgeschlossene Gold-Review unter{" "}
        <Link href="/gold" className="underline">
          Gold
        </Link>
        .
      </p>
    );
  }

  const [current, prices] = await Promise.all([listCurrentEvaluations(db, gold), getPriceTable(db)]);
  const runs = await Promise.all(
    current.runs.map(async ({ run, evaluation }) => ({
      run: (await getRun(db, run.id)) as RunView,
      evaluation,
    })),
  );
  const analysis = buildAnalysis({ runs, prices, filters: requested.filters });
  const state = { filters: analysis.filters, xAxis: requested.xAxis };

  return (
    <>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Abgeschlossene Benchmark-Läufe, bewertet gegen{" "}
        <span data-testid="analysis-gold">{current.goldVersion}</span>. Verglichen werden nur Läufe mit
        gleichem Prompt- und Snapshot-Hash und gleichem Modus; je Konfiguration zählt der neueste Lauf. Kosten{" "}
        {ESTIMATE_NOTE}, pro Unit der Gold-Version.
        {current.incomplete.length > 0 && (
          <>
            {" "}
            <span data-testid="analysis-incomplete">
              {current.incomplete.length} Lauf/Läufe unvollständig für {current.goldVersion} und ausgeblendet
            </span>{" "}
            (unter{" "}
            <Link href="/laeufe" className="underline">
              Läufe
            </Link>{" "}
            ergänzen).
          </>
        )}
      </p>

      {analysis.entries.length === 0 ? (
        <p className="text-muted-foreground" data-testid="analysis-empty">
          Noch keine auswertbaren Läufe.
        </p>
      ) : (
        <>
          <FilterBar analysis={analysis} state={state} />
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Score gegen Aufwand</h2>
            <ScatterPlot
              axis={state.xAxis}
              efficient={analysis.efficient[state.xAxis]}
              points={analysis.entries.map((entry) => ({
                runId: entry.runId,
                label: `${entry.configuration.model} · ${entry.configuration.effort}`,
                detail: `${HARNESS_LABELS[entry.configuration.harness]} · ${MODE_LABELS[entry.configuration.mode]} · Lauf #${entry.runId}`,
                score: entry.score,
                interval: entry.interval,
                x: xValue(entry, state.xAxis),
              }))}
            />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Rangliste</h2>
            <LeaderboardTable entries={analysis.entries} />
            <p className="text-xs text-muted-foreground">* {ESTIMATE_NOTE}</p>
          </section>
        </>
      )}
    </>
  );
}
