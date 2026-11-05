"use client";

import { useState } from "react";
import type { XAxis } from "@/server/analysis/leaderboard";
import { axisValueLabel, X_AXIS_LABELS } from "./format";

export interface ScatterPoint {
  runId: number;
  /** Modell · Effort (Direktbeschriftung der effizienten Punkte). */
  label: string;
  /** Harness · Modus (Tooltip). */
  detail: string;
  score: number;
  interval: { low: number; high: number } | null;
  /** `null` = unbekannt: eigener Streifen rechts, nie bei 0. */
  x: number | null;
}

const WIDTH = 760;
const HEIGHT = 380;
const MARGIN = { top: 16, right: 24, bottom: 44, left: 52 };
const UNKNOWN_STRIP = 130;
/** Rechts davon stehen Direktbeschriftungen links vom Punkt, damit sie nicht über den Rand laufen. */
const LABEL_ROOM = 170;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Scatter-Plot Score gegen die gewählte x-Achse. Der effizienteste Bereich ist die Pareto-Front (Treppenlinie
 * mit hinterlegter Fläche); ihre Punkte sind direkt beschriftet. Läufe mit unbekanntem x-Wert stehen in einem
 * abgesetzten Streifen „unbekannt“. Jeder Punkt führt zur Lauf-Detailansicht.
 */
export function ScatterPlot({
  points,
  axis,
  efficient,
}: {
  points: ScatterPoint[];
  axis: XAxis;
  /** Lauf-IDs der Pareto-Front, aufsteigend nach x. */
  efficient: number[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const known = points.filter((point): point is ScatterPoint & { x: number } => point.x !== null);
  const unknown = points.filter((point) => point.x === null);

  const plotRight = WIDTH - MARGIN.right - (unknown.length > 0 ? UNKNOWN_STRIP : 0);
  const plotBottom = HEIGHT - MARGIN.bottom;
  const xTicks = niceTicks(Math.max(0, ...known.map((point) => point.x)));
  const xMax = xTicks.at(-1) ?? 1;
  const sx = (value: number) => MARGIN.left + (value / xMax) * (plotRight - MARGIN.left);
  const sy = (value: number) => plotBottom - value * (plotBottom - MARGIN.top);
  const unknownX = plotRight + UNKNOWN_STRIP / 2;
  const position = (point: ScatterPoint) => ({
    cx: point.x === null ? unknownX : sx(point.x),
    cy: sy(point.score),
  });

  const efficientSet = new Set(efficient);
  const front = efficient
    .map((id) => known.find((point) => point.runId === id))
    .filter((point): point is ScatterPoint & { x: number } => point !== undefined);
  const stairs = front.flatMap((point, index) => {
    const next = front[index + 1];
    const y = sy(point.score);
    return next
      ? [`${sx(point.x)},${y}`, `${sx(next.x)},${y}`]
      : [`${sx(point.x)},${y}`, `${plotRight},${y}`];
  });
  const hoveredPoint = points.find((point) => point.runId === hovered) ?? null;

  return (
    <figure className="viz-root space-y-2" data-testid="scatter-plot">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <LegendItem label="Lauf (Strich: Intervall)">
          <circle cx={7} cy={7} r={5} fill="var(--viz-series-1)" />
        </LegendItem>
        {front.length > 0 && (
          <LegendItem label="Effizienzgrenze (effizientester Bereich)">
            <rect x={0} y={4} width={14} height={10} fill="var(--viz-series-1)" opacity={0.1} />
            <line x1={0} x2={14} y1={4} y2={4} stroke="var(--viz-ink-secondary)" strokeWidth={1.5} />
          </LegendItem>
        )}
        {unknown.length > 0 && (
          <LegendItem label="x-Wert unbekannt">
            <circle
              cx={7}
              cy={7}
              r={4}
              fill="var(--viz-surface)"
              stroke="var(--viz-series-1)"
              strokeWidth={2}
            />
          </LegendItem>
        )}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full rounded-md border"
          style={{ background: "var(--viz-surface)" }}
          role="img"
          aria-label={`Scatter-Plot: Score gegen ${X_AXIS_LABELS[axis]}`}
        >
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={plotRight}
                y1={sy(tick)}
                y2={sy(tick)}
                stroke="var(--viz-grid)"
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
          {xTicks.map((tick) => (
            <text
              key={tick}
              x={sx(tick)}
              y={plotBottom + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--viz-muted)"
            >
              {axisValueLabel(axis, tick)}
            </text>
          ))}
          <line
            x1={MARGIN.left}
            x2={plotRight}
            y1={plotBottom}
            y2={plotBottom}
            stroke="var(--viz-axis)"
            strokeWidth={1}
          />
          <text
            x={(MARGIN.left + plotRight) / 2}
            y={HEIGHT - 6}
            textAnchor="middle"
            fontSize={12}
            fill="var(--viz-ink-secondary)"
          >
            {X_AXIS_LABELS[axis]}
            {axis === "cost" ? " (geschätzt zum API-Listenpreis)" : ""}
          </text>
          <text
            transform={`translate(14 ${(MARGIN.top + plotBottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={12}
            fill="var(--viz-ink-secondary)"
          >
            Score
          </text>

          {front.length > 0 && (
            <g data-testid="scatter-efficient" aria-label="effizientester Bereich" pointerEvents="none">
              <polygon
                points={[...stairs, `${plotRight},${plotBottom}`, `${sx(front[0].x)},${plotBottom}`].join(
                  " ",
                )}
                fill="var(--viz-series-1)"
                opacity={0.1}
              />
              <polyline
                points={stairs.join(" ")}
                fill="none"
                stroke="var(--viz-ink-secondary)"
                strokeWidth={1.5}
              />
            </g>
          )}

          {unknown.length > 0 && (
            <g>
              <line
                x1={plotRight + 8}
                x2={plotRight + 8}
                y1={MARGIN.top}
                y2={plotBottom}
                stroke="var(--viz-axis)"
                strokeWidth={1}
              />
              <text
                x={unknownX}
                y={plotBottom + 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--viz-muted)"
              >
                unbekannt
              </text>
            </g>
          )}

          <g data-testid="scatter-known">
            {known.map((point) => (
              <PointMark
                key={point.runId}
                point={point}
                {...position(point)}
                sy={sy}
                efficient={efficientSet.has(point.runId)}
                labelLeft={sx(point.x) > plotRight - LABEL_ROOM}
                onHover={setHovered}
              />
            ))}
          </g>
          {unknown.length > 0 && (
            <g data-testid="scatter-unknown">
              {unknown.map((point) => (
                <PointMark
                  key={point.runId}
                  point={point}
                  {...position(point)}
                  sy={sy}
                  hollow
                  onHover={setHovered}
                />
              ))}
            </g>
          )}
        </svg>
        {hoveredPoint && <Tooltip point={hoveredPoint} axis={axis} {...position(hoveredPoint)} />}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Punkt = Lauf, Strich = Bootstrap-Intervall, Linie = Effizienzgrenze.
        {unknown.length > 0 && " Hohle Punkte rechts: x-Wert unbekannt (nicht 0)."} Klick öffnet den Lauf.
      </figcaption>
    </figure>
  );
}

function LegendItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
        {children}
      </svg>
      {label}
    </span>
  );
}

function PointMark({
  point,
  cx,
  cy,
  sy,
  efficient = false,
  hollow = false,
  labelLeft = false,
  onHover,
}: {
  point: ScatterPoint;
  cx: number;
  cy: number;
  sy: (value: number) => number;
  efficient?: boolean;
  hollow?: boolean;
  labelLeft?: boolean;
  onHover: (runId: number | null) => void;
}) {
  return (
    <a
      href={`/laeufe/${point.runId}`}
      data-testid="scatter-point"
      data-run-id={point.runId}
      aria-label={`${point.label}, Score ${point.score.toFixed(3)}`}
      onMouseEnter={() => onHover(point.runId)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(point.runId)}
      onBlur={() => onHover(null)}
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
        r={5}
        fill={hollow ? "var(--viz-surface)" : "var(--viz-series-1)"}
        stroke={hollow ? "var(--viz-series-1)" : "var(--viz-surface)"}
        strokeWidth={2}
      />
      {efficient && (
        <text
          x={labelLeft ? cx - 9 : cx + 9}
          y={cy - 8}
          textAnchor={labelLeft ? "end" : "start"}
          fontSize={11}
          fill="var(--viz-ink)"
        >
          {point.label}
        </text>
      )}
    </a>
  );
}

function Tooltip({ point, axis, cx, cy }: { point: ScatterPoint; axis: XAxis; cx: number; cy: number }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-sm"
      style={{
        left: `${(cx / WIDTH) * 100}%`,
        top: `${(cy / HEIGHT) * 100}%`,
        transform: "translate(12px, -50%)",
      }}
    >
      <div className="font-medium">{point.label}</div>
      <div className="text-muted-foreground">{point.detail}</div>
      <div className="mt-1 tabular-nums">
        Score {point.score.toFixed(3)}
        {point.interval && ` (${point.interval.low.toFixed(3)}–${point.interval.high.toFixed(3)})`}
      </div>
      <div className="tabular-nums">
        {X_AXIS_LABELS[axis]}: {point.x === null ? "unbekannt" : axisValueLabel(axis, point.x)}
      </div>
    </div>
  );
}

/** Gleichmäßige Achsenteilung ab 0 mit „runden“ Schritten (1, 2, 5 × 10^n). */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let value = 0; value < max + step * 0.999; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}
