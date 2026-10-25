"use client";

import { useState } from "react";
import type { CategoryChart } from "@/server/analysis/views";
import type { Category } from "@/server/scoring/model";
import { CATEGORY_LABELS, formatScore } from "../laeufe/labels";
import { seriesColor } from "./format";

const WIDTH = 760;
const HEIGHT = 300;
const MARGIN = { top: 16, right: 16, bottom: 40, left: 52 };
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const BAR_GAP = 2;
const RADIUS = 4;

/** Kurze Achsenbeschriftung; der volle Name steht im Tooltip und in der Tabelle. */
const SHORT_CATEGORY_LABELS: Record<Category, string> = {
  a: "a breit",
  b: "b eng",
  c: "c no_mapping",
  d: "d Kern/direkt",
  e: "e name_only",
  f: "f schwierig",
};

export function seriesLabel(series: CategoryChart["series"][number]): string {
  return `${series.configuration.model} · ${series.configuration.effort}`;
}

/** Balken mit 4-px-Rundung nur am Datenende; die Basis sitzt eckig auf der Grundlinie. */
function barPath(x: number, y: number, width: number, baseline: number): string {
  const r = Math.min(RADIUS, width / 2, baseline - y);
  return [
    `M${x},${baseline}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${baseline}`,
    "Z",
  ].join(" ");
}

interface Hover {
  seriesIndex: number;
  categoryIndex: number;
  x: number;
  y: number;
}

/**
 * Score je Kategorie als gruppierte Balken: je Kategorie eine Gruppe, je gewähltem Lauf ein Balken. Legende
 * über dem Diagramm, Tooltip je Balken, Werte zusätzlich als Tabelle.
 */
export function CategoryChartView({ chart }: { chart: CategoryChart }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const plotBottom = HEIGHT - MARGIN.bottom;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const groupWidth = plotWidth / Math.max(1, chart.categories.length);
  const barsWidth = groupWidth * 0.7;
  const barWidth = (barsWidth - BAR_GAP * (chart.series.length - 1)) / Math.max(1, chart.series.length);
  const sy = (value: number) => plotBottom - value * (plotBottom - MARGIN.top);
  const barX = (categoryIndex: number, seriesIndex: number) =>
    MARGIN.left +
    categoryIndex * groupWidth +
    (groupWidth - barsWidth) / 2 +
    seriesIndex * (barWidth + BAR_GAP);
  const hovered = hover ? chart.series[hover.seriesIndex] : null;

  return (
    <figure className="viz-root space-y-2" data-testid="category-chart">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {chart.series.map((series, index) => (
          <span key={series.runId} className="inline-flex items-center gap-1.5" data-testid="category-legend">
            <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
              <rect width={12} height={12} rx={3} fill={seriesColor(index)} />
            </svg>
            {seriesLabel(series)} (Lauf #{series.runId})
          </span>
        ))}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full rounded-md border"
          style={{ background: "var(--viz-surface)" }}
          role="img"
          aria-label="Score je Kategorie für die gewählten Läufe"
        >
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={sy(tick)}
                y2={sy(tick)}
                stroke={tick === 0 ? "var(--viz-axis)" : "var(--viz-grid)"}
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 8}
                y={sy(tick)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--viz-muted)"
              >
                {tick.toFixed(2)}
              </text>
            </g>
          ))}
          <text
            transform={`translate(14 ${(MARGIN.top + plotBottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={12}
            fill="var(--viz-ink-secondary)"
          >
            Score
          </text>
          {chart.categories.map(({ category, unitCount }, categoryIndex) => (
            <g key={category}>
              <text
                x={MARGIN.left + (categoryIndex + 0.5) * groupWidth}
                y={plotBottom + 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--viz-ink-secondary)"
              >
                {SHORT_CATEGORY_LABELS[category]}
              </text>
              <text
                x={MARGIN.left + (categoryIndex + 0.5) * groupWidth}
                y={plotBottom + 30}
                textAnchor="middle"
                fontSize={10}
                fill="var(--viz-muted)"
              >
                {unitCount} {unitCount === 1 ? "Unit" : "Units"}
              </text>
              {chart.series.map((series, seriesIndex) => {
                const score = series.scores[categoryIndex];
                if (score === null) return null;
                const x = barX(categoryIndex, seriesIndex);
                const y = sy(score);
                const active = hover?.seriesIndex === seriesIndex && hover.categoryIndex === categoryIndex;
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: Tooltip beim Überfahren; Werte stehen auch in der Tabelle
                  <g
                    key={series.runId}
                    data-testid="category-bar"
                    data-run-id={series.runId}
                    data-category={category}
                    data-score={score}
                    onMouseEnter={() => setHover({ seriesIndex, categoryIndex, x: x + barWidth / 2, y })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <rect
                      x={x - 2}
                      y={MARGIN.top}
                      width={barWidth + 4}
                      height={plotBottom - MARGIN.top}
                      fill="transparent"
                    />
                    <path
                      d={barPath(x, Math.min(y, plotBottom - 1), barWidth, plotBottom)}
                      fill={seriesColor(seriesIndex)}
                      opacity={hover && !active ? 0.55 : 1}
                    />
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
        {hover && hovered && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-sm"
            style={{
              left: `${(hover.x / WIDTH) * 100}%`,
              top: `${(hover.y / HEIGHT) * 100}%`,
              transform: "translate(-50%, calc(-100% - 8px))",
            }}
          >
            <div className="font-medium">{seriesLabel(hovered)}</div>
            <div className="text-muted-foreground">
              {CATEGORY_LABELS[chart.categories[hover.categoryIndex].category]}
            </div>
            <div className="mt-1 tabular-nums">Score {formatScore(hovered.scores[hover.categoryIndex])}</div>
          </div>
        )}
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
