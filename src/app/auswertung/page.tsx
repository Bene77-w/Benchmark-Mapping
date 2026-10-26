import Link from "next/link";
import { Suspense } from "react";
import {
  type Analysis,
  type AnalysisState,
  buildAnalysis,
  parseAnalysisParams,
  xValue,
} from "@/server/analysis/leaderboard";
import {
  buildCategoryChart,
  buildHeatmap,
  buildScoreHistory,
  type CategoryChart,
  MAX_CATEGORY_RUNS,
  type ScoreHistory,
} from "@/server/analysis/views";
import { getDatabase } from "@/server/db/client";
import { getActiveGold } from "@/server/gold/active";
import { HARNESS_LABELS } from "@/server/harness/adapter";
import { getPriceTable } from "@/server/pricing/store";
import type { RunView } from "@/server/runs/model";
import { getRun } from "@/server/runs/store";
import { listCurrentEvaluations } from "@/server/scoring/current";
import { ESTIMATE_NOTE } from "../laeufe/[id]/costs";
import { configurationLabel, MODE_LABELS } from "../laeufe/labels";
import { CategoryChartView } from "./category-chart";
import { analysisHref, FilterBar, FilterGroup, FilterLink } from "./filter-bar";
import { seriesColor } from "./format";
import { HeatmapView } from "./heatmap";
import { LeaderboardTable } from "./leaderboard-table";
import { ScatterPlot } from "./scatter-plot";
import { ScoreHistoryChart } from "./score-history";

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
  const state = { ...requested, filters: analysis.filters };
  const categoryChart = buildCategoryChart(analysis.entries, requested.categoryRuns);
  const history = buildScoreHistory(analysis, requested.historyConfiguration);

  return (
    <>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Abgeschlossene Benchmark-Läufe, bewertet gegen{" "}
        <span data-testid="analysis-gold">{current.goldVersion}</span>. Verglichen werden nur Läufe mit
        gleichem Prompt- und Snapshot-Hash und gleichem Modus. Rangliste, Scatter-Plot und Heatmap zeigen alle
        Läufe, auch wiederholte einer Konfiguration; die Umschalter „nur neueste“ und „nur beste je
        Konfiguration“ beschränken sie auf einen Lauf je Konfiguration („beste Stufe je Modell“ wählt immer
        aus allen Läufen). Bei gleichem Score steht der günstigere Lauf vorn. Kosten {ESTIMATE_NOTE}, pro Unit der Gold-Version.
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
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Score je Kategorie</h2>
            <CategorySelection analysis={analysis} state={state} chart={categoryChart} />
            <CategoryChartView chart={categoryChart} />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Heatmap Läufe × Units</h2>
            <HeatmapView heatmap={buildHeatmap(analysis.entries)} />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Verlauf je Konfiguration</h2>
            <HistorySelection state={state} history={history} />
            {history.configuration && (
              <ScoreHistoryChart points={history.points} label={configurationLabel(history.configuration)} />
            )}
          </section>
        </>
      )}
    </>
  );
}

/** Auswahl der Läufe des Kategorie-Diagramms aus der Rangliste (höchstens vier); die Farbe folgt der Auswahl. */
function CategorySelection({
  analysis,
  state,
  chart,
}: {
  analysis: Analysis;
  state: AnalysisState;
  chart: CategoryChart;
}) {
  const selected = chart.series.map((series) => series.runId);
  // Wiederholte Läufe einer Konfiguration bekommen ihre Lauf-ID dazu, damit sie unterscheidbar bleiben.
  const runsPerConfiguration = Map.groupBy(analysis.entries, (entry) => entry.configuration.id);
  return (
    <FilterGroup label={`Läufe (höchstens ${MAX_CATEGORY_RUNS})`}>
      {analysis.entries.map((entry) => {
        const index = selected.indexOf(entry.runId);
        const isSelected = index >= 0;
        const next = isSelected ? selected.filter((id) => id !== entry.runId) : [...selected, entry.runId];
        const disabled = isSelected ? next.length === 0 : selected.length >= MAX_CATEGORY_RUNS;
        return (
          <FilterLink
            key={entry.runId}
            href={analysisHref(state, { categoryRuns: next })}
            active={isSelected}
            disabled={disabled}
            title={`${configurationLabel(entry.configuration)}, Lauf #${entry.runId}`}
            data-testid="category-toggle"
            data-run-id={entry.runId}
            data-selected={String(isSelected)}
          >
            {isSelected && (
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block size-2.5 rounded-sm align-middle"
                style={{ background: seriesColor(index) }}
              />
            )}
            {entry.configuration.model} · {entry.configuration.effort}
            {(runsPerConfiguration.get(entry.configuration.id)?.length ?? 0) > 1 && ` · #${entry.runId}`}
          </FilterLink>
        );
      })}
    </FilterGroup>
  );
}

/** Auswahl der Konfiguration des Verlaufs: die Konfigurationen der Rangliste. */
function HistorySelection({ state, history }: { state: AnalysisState; history: ScoreHistory }) {
  return (
    <FilterGroup label="Konfiguration">
      {history.configurations.map(({ configuration, runCount }) => (
        <FilterLink
          key={configuration.id}
          href={analysisHref(state, { historyConfiguration: configuration.id })}
          active={configuration.id === history.configuration?.id}
          title={configurationLabel(configuration)}
          data-testid="history-configuration"
          data-configuration-id={configuration.id}
        >
          {configuration.model} · {configuration.effort} ({runCount} {runCount === 1 ? "Lauf" : "Läufe"})
        </FilterLink>
      ))}
    </FilterGroup>
  );
}
