"use client";

import { useState } from "react";
import type { ScoreHistoryPoint } from "@/server/analysis/views";
import { formatScore } from "../laeufe/labels";

const WIDTH = 760;
const HEIGHT = 260;
const MARGIN = { top: 16, right: 32, bottom: 36, left: 52 };
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const DAY_MS = 86_400_000;

/** Achsenbeschriftung: bei kurzem Zeitraum mit Uhrzeit, sonst nur das Datum. */
function tickLabel(date: Date, short: boolean): string {
  return short
    ? date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function dateTimeLabel(date: Date): string {
  return date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Verlauf des Scores einer Konfiguration über das Laufdatum: eine Linie (2 px) durch alle Läufe, Punkte mit
 * Bootstrap-Intervall. Tooltip je Punkt, Klick öffnet den Lauf; die Werte stehen zusätzlich in einer Tabelle.
 */
export function ScoreHistoryChart({ points, label }: { points: ScoreHistoryPoint[]; label: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const times = points.map((point) => point.createdAt.getTime());
  let start = Math.min(...times);
  let end = Math.max(...times);
  if (end - start < DAY_MS) {
    const middle = (start + end) / 2;
    start = middle - DAY_MS / 2;
    end = middle + DAY_MS / 2;
  }
  const plotRight = WIDTH - MARGIN.right;
  const plotBottom = HEIGHT - MARGIN.bottom;
  const sx = (time: number) => MARGIN.left + ((time - start) / (end - start)) * (plotRight - MARGIN.left);
  const sy = (value: number) => plotBottom - value * (plotBottom - MARGIN.top);
  const xTicks = [0, 1 / 3, 2 / 3, 1].map((fraction) => start + fraction * (end - start));
  const positioned = points.map((point) => ({
    point,
    cx: sx(point.createdAt.getTime()),
    cy: sy(point.score),
  }));
  const hoveredPoint = positioned.find(({ point }) => point.runId === hovered) ?? null;

  return (
    <figure className="viz-root space-y-2" data-testid="history-chart">
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full rounded-md border"
          style={{ background: "var(--viz-surface)" }}
          role="img"
          aria-label={`Verlauf des Scores: ${label}`}
        >
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={plotRight}
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
          {xTicks.map((tick, index) => (
            <text
              key={tick}
              x={sx(tick)}
              y={plotBottom + 16}
              textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
              fontSize={11}
              fill="var(--viz-muted)"
            >
              {tickLabel(new Date(tick), end - start <= 3 * DAY_MS)}
            </text>
          ))}
          <text
            transform={`translate(14 ${(MARGIN.top + plotBottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={12}
            fill="var(--viz-ink-secondary)"
          >
            Score
          </text>
          {positioned.length > 1 && (
            <polyline
              points={positioned.map(({ cx, cy }) => `${cx},${cy}`).join(" ")}
              fill="none"
              stroke="var(--viz-series-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              pointerEvents="none"
            />
          )}
          {positioned.map(({ point, cx, cy }) => (
            <a
              key={point.runId}
              href={`/laeufe/${point.runId}`}
              data-testid="history-point"
              data-run-id={point.runId}
              aria-label={`Lauf #${point.runId} vom ${dateTimeLabel(point.createdAt)}, Score ${formatScore(point.score)}`}
              onMouseEnter={() => setHovered(point.runId)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(point.runId)}
              onBlur={() => setHovered(null)}
            >
              {point.interval && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={sy(point.interval.low)}
                  y2={sy(point.interval.high)}
                  stroke="var(--viz-series-1)"
                  strokeWidth={1}
                  opacity={0.5}
                />
              )}
              <circle cx={cx} cy={cy} r={12} fill="transparent" />
              <circle
                cx={cx}
                cy={cy}
                r={hovered === point.runId ? 6 : 5}
                fill="var(--viz-series-1)"
                stroke="var(--viz-surface)"
                strokeWidth={2}
              />
            </a>
          ))}
        </svg>
        {hoveredPoint && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-sm"
            style={{
              left: `${(hoveredPoint.cx / WIDTH) * 100}%`,
              top: `${(hoveredPoint.cy / HEIGHT) * 100}%`,
              transform:
                hoveredPoint.cx > WIDTH * 0.7
                  ? "translate(calc(-100% - 12px), -50%)"
                  : "translate(12px, -50%)",
            }}
          >
            <div className="font-medium">Lauf #{hoveredPoint.point.runId}</div>
            <div className="text-muted-foreground">{dateTimeLabel(hoveredPoint.point.createdAt)}</div>
            <div className="mt-1 tabular-nums">
              Score {formatScore(hoveredPoint.point.score)}
              {hoveredPoint.point.interval &&
                ` (${formatScore(hoveredPoint.point.interval.low)}–${formatScore(hoveredPoint.point.interval.high)})`}
            </div>
          </div>
        )}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Werte als Tabelle</summary>
        <table className="mt-2 tabular-nums">
          <thead>
            <tr>
              <th className="pr-4 text-left font-medium">Datum</th>
              <th className="pr-4 text-left font-medium">Lauf</th>
              <th className="pr-4 text-right font-medium">Score</th>
              <th className="text-right font-medium">Intervall</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.runId}>
                <td className="pr-4">{dateTimeLabel(point.createdAt)}</td>
                <td className="pr-4">
                  <a href={`/laeufe/${point.runId}`} className="underline-offset-4 hover:underline">
                    #{point.runId}
                  </a>
                </td>
                <td className="pr-4 text-right">{formatScore(point.score)}</td>
                <td className="text-right">
                  {point.interval
                    ? `${formatScore(point.interval.low)}–${formatScore(point.interval.high)}`
                    : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <figcaption className="text-xs text-muted-foreground">
        Alle auswertbaren Läufe dieser Konfiguration mit gleichem Prompt, Snapshot und Modus, nach Datum
        (senkrechter Strich: Bootstrap-Intervall). Klick öffnet den Lauf.
      </figcaption>
    </figure>
  );
}
