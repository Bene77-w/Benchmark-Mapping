"use client";

// PROTOTYP – wegwerfen (Branch prototyp/diagramme): Kategorie-Diagramm wie `category-chart.tsx`, aber mit Recharts.

import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoryChart } from "@/server/analysis/views";
import type { Category } from "@/server/scoring/model";
import { CATEGORY_LABELS, formatScore } from "../laeufe/labels";
import { seriesLabel } from "./category-chart";
import { seriesColor } from "./format";

const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const SHORT_CATEGORY_LABELS: Record<Category, string> = {
  a: "a breit",
  b: "b eng",
  c: "c no_mapping",
  d: "d Kern/direkt",
  e: "e name_only",
  f: "f schwierig",
};

export function PrototypeRechartsCategoryChart({ chart }: { chart: CategoryChart }) {
  const data = chart.categories.map(({ category, unitCount }, index) => ({
    category,
    unitCount,
    ...Object.fromEntries(chart.series.map((series) => [`run${series.runId}`, series.scores[index]])),
  }));

  return (
    <figure className="viz-root space-y-2" data-testid="category-chart">
      <div className="rounded-md border" style={{ background: "var(--viz-surface)" }}>
        <BarChart
          responsive
          style={{ width: "100%", aspectRatio: 760 / 320 }}
          data={data}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          barGap={2}
          barCategoryGap="15%"
          accessibilityLayer
          title="Score je Kategorie für die gewählten Läufe"
        >
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis
            dataKey="category"
            stroke="var(--viz-axis)"
            height={36}
            tick={({ x, y, payload, index }) => (
              <g transform={`translate(${x},${y})`}>
                <text dy={12} textAnchor="middle" fontSize={11} fill="var(--viz-ink-secondary)">
                  {SHORT_CATEGORY_LABELS[payload.value as Category]}
                </text>
                <text dy={26} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">
                  {data[index].unitCount} {data[index].unitCount === 1 ? "Unit" : "Units"}
                </text>
              </g>
            )}
          />
          <YAxis
            domain={[0, 1]}
            ticks={Y_TICKS}
            tickFormatter={(value: number) => value.toFixed(2)}
            tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
            stroke="var(--viz-axis)"
            label={{
              value: "Score",
              angle: -90,
              position: "insideLeft",
              fontSize: 12,
              fill: "var(--viz-ink-secondary)",
            }}
          />
          <Legend verticalAlign="top" align="left" height={28} wrapperStyle={{ fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-sm">
                  <div className="font-medium">{CATEGORY_LABELS[label as Category]}</div>
                  {payload.map((entry) => (
                    <div key={String(entry.dataKey)} className="flex items-center gap-1.5 tabular-nums">
                      <span
                        className="inline-block size-2.5 rounded-sm"
                        style={{ background: entry.color }}
                      />
                      {entry.name}: {formatScore(entry.value as number | null)}
                    </div>
                  ))}
                </div>
              ) : null
            }
          />
          {chart.series.map((series, index) => (
            <Bar
              key={series.runId}
              dataKey={`run${series.runId}`}
              name={`${seriesLabel(series)} (Lauf #${series.runId})`}
              fill={seriesColor(index)}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Werte als Tabelle</summary>
        <table className="mt-2 tabular-nums">
          <thead>
            <tr>
              <th className="pr-4 text-left font-medium">Lauf</th>
              {chart.categories.map(({ category }) => (
                <th key={category} className="pr-4 text-right font-medium">
                  {CATEGORY_LABELS[category]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.series.map((series) => (
              <tr key={series.runId}>
                <td className="pr-4">
                  {seriesLabel(series)} (#{series.runId})
                </td>
                {series.scores.map((score, index) => (
                  <td key={chart.categories[index].category} className="pr-4 text-right">
                    {formatScore(score)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
