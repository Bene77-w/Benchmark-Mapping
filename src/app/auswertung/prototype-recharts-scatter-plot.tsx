"use client";

// PROTOTYP – wegwerfen (Branch prototyp/diagramme): Scatter-Plot wie `scatter-plot.tsx`, aber mit Recharts.

import {
  CartesianGrid,
  ErrorBar,
  Legend,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { XAxis as AxisKind } from "@/server/analysis/leaderboard";
import { axisValueLabel, X_AXIS_LABELS } from "./format";
import type { ScatterPoint } from "./scatter-plot";

type Row = ScatterPoint & {
  plotX: number;
  error: [number, number] | null;
  efficient: boolean;
  labelLeft: boolean;
};

const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const AXIS_TICK = { fontSize: 11, fill: "var(--viz-muted)" };

export function PrototypeRechartsScatterPlot({
  points,
  axis,
  efficient,
}: {
  points: ScatterPoint[];
  axis: AxisKind;
  efficient: number[];
}) {
  const known = points.filter((point): point is ScatterPoint & { x: number } => point.x !== null);
  const unknown = points.filter((point) => point.x === null);
  const xTicks = niceTicks(Math.max(0, ...known.map((point) => point.x)));
  const xMax = xTicks.at(-1) ?? 1;
  // Recharts kennt nur eine x-Achse: „unbekannt“ steht als künstlicher Wert rechts neben dem Wertebereich.
  const unknownX = xMax * 1.22;
  const domainMax = unknown.length > 0 ? xMax * 1.35 : xMax;
  const efficientSet = new Set(efficient);
  const row = (point: ScatterPoint, plotX: number): Row => ({
    ...point,
    plotX,
    efficient: efficientSet.has(point.runId),
    labelLeft: plotX > xMax * 0.72,
    error: point.interval ? [point.score - point.interval.low, point.interval.high - point.score] : null,
  });
  const knownRows = known.map((point) => row(point, point.x));
  const unknownRows = unknown.map((point) => row(point, unknownX));
  const front = efficient
    .map((id) => known.find((point) => point.runId === id))
    .filter((point) => point !== undefined)
    .map((point) => ({ plotX: point.x, score: point.score }));
  // Treppe der Effizienzgrenze: je Stufe eine Fläche (ReferenceArea) und die Kante als Linie (Scatter ohne Punkte).
  const steps = front.map((point, index) => ({ ...point, to: front[index + 1]?.plotX ?? xMax }));
  const stairs = steps.flatMap((step) => [
    { plotX: step.plotX, score: step.score },
    { plotX: step.to, score: step.score },
  ]);

  return (
    <figure className="viz-root space-y-2" data-testid="scatter-plot">
      <div className="rounded-md border" style={{ background: "var(--viz-surface)" }}>
        <ScatterChart
          responsive
          style={{ width: "100%", aspectRatio: 760 / 400 }}
          margin={{ top: 16, right: 24, bottom: 24, left: 8 }}
          accessibilityLayer
          title={`Scatter-Plot: Score gegen ${X_AXIS_LABELS[axis]}`}
        >
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis
            type="number"
            dataKey="plotX"
            domain={[0, domainMax]}
            ticks={unknown.length > 0 ? [...xTicks, unknownX] : xTicks}
            tickFormatter={(value: number) =>
              value === unknownX ? "unbekannt" : axisValueLabel(axis, value)
            }
            tick={AXIS_TICK}
            stroke="var(--viz-axis)"
            label={{
              value: `${X_AXIS_LABELS[axis]}${axis === "cost" ? " (geschätzt zum API-Listenpreis)" : ""}`,
              position: "insideBottom",
              offset: -16,
              fontSize: 12,
              fill: "var(--viz-ink-secondary)",
            }}
          />
          <YAxis
            type="number"
            dataKey="score"
            domain={[0, 1]}
            ticks={Y_TICKS}
            tickFormatter={(value: number) => value.toFixed(2)}
            tick={AXIS_TICK}
            stroke="var(--viz-axis)"
            label={{
              value: "Score",
              angle: -90,
              position: "insideLeft",
              fontSize: 12,
              fill: "var(--viz-ink-secondary)",
            }}
          />
          {unknown.length > 0 && <ReferenceLine x={xMax * 1.08} stroke="var(--viz-axis)" />}
          <Legend verticalAlign="top" align="left" height={28} wrapperStyle={{ fontSize: 12 }} />
          {steps.map((step) => (
            <ReferenceArea
              key={step.plotX}
              x1={step.plotX}
              x2={step.to}
              y1={0}
              y2={step.score}
              fill="var(--viz-series-1)"
              fillOpacity={0.1}
              strokeOpacity={0}
            />
          ))}
          {stairs.length > 0 && (
            <Scatter
              data={stairs}
              dataKey="score"
              name="Effizienzgrenze (effizientester Bereich)"
              line={{ stroke: "var(--viz-ink-secondary)", strokeWidth: 1.5 }}
              shape={() => <g />}
              fill="var(--viz-ink-secondary)"
              legendType="line"
              tooltipType="none"
              isAnimationActive={false}
            />
          )}
          <Scatter
            data={knownRows}
            dataKey="score"
            name="Lauf (Strich: Intervall)"
            fill="var(--viz-series-1)"
            shape={(props: ShapeProps) => <PointShape {...props} />}
            isAnimationActive={false}
          >
            <ErrorBar
              dataKey="error"
              direction="y"
              width={0}
              stroke="var(--viz-series-1)"
              strokeOpacity={0.5}
            />
          </Scatter>
          {unknownRows.length > 0 && (
            <Scatter
              data={unknownRows}
              dataKey="score"
              name="x-Wert unbekannt"
              fill="var(--viz-series-1)"
              shape={(props: ShapeProps) => <PointShape {...props} hollow />}
              isAnimationActive={false}
            >
              <ErrorBar
                dataKey="error"
                direction="y"
                width={0}
                stroke="var(--viz-series-1)"
                strokeOpacity={0.5}
              />
            </Scatter>
          )}
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              // Die Fläche der Effizienzgrenze liefert ebenfalls Einträge: nur Läufe zeigen einen Tooltip.
              const point = active
                ? payload?.map((entry) => entry.payload as Row).find((row) => row?.runId !== undefined)
                : undefined;
              if (!point) return null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-sm">
                  <div className="font-medium">{point.label}</div>
                  <div className="text-muted-foreground">{point.detail}</div>
                  <div className="mt-1 tabular-nums">
                    Score {point.score.toFixed(3)}
                    {point.interval &&
                      ` (${point.interval.low.toFixed(3)}–${point.interval.high.toFixed(3)})`}
                  </div>
                  <div className="tabular-nums">
                    {X_AXIS_LABELS[axis]}: {point.x === null ? "unbekannt" : axisValueLabel(axis, point.x)}
                  </div>
                </div>
              );
            }}
          />
        </ScatterChart>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Jeder Punkt ist ein Lauf (senkrechter Strich: Bootstrap-Intervall). Effizienzgrenze: Läufe, die kein
        anderer bei höchstens gleichem Aufwand im Score übertrifft.
        {unknown.length > 0 && " Hohle Punkte rechts: x-Wert unbekannt (nicht 0)."} Klick öffnet den Lauf.
      </figcaption>
    </figure>
  );
}

interface ShapeProps {
  cx?: number;
  cy?: number;
  payload?: Row;
}

/** Punkt als Link zur Lauf-Detailansicht; effiziente Punkte direkt beschriftet. */
function PointShape({ cx = 0, cy = 0, payload, hollow = false }: ShapeProps & { hollow?: boolean }) {
  if (payload?.runId === undefined) return null;
  const { labelLeft } = payload;
  return (
    <a
      href={`/laeufe/${payload.runId}`}
      data-testid="scatter-point"
      data-run-id={payload.runId}
      aria-label={`${payload.label}, Score ${payload.score.toFixed(3)}`}
    >
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={hollow ? "var(--viz-surface)" : "var(--viz-series-1)"}
        stroke={hollow ? "var(--viz-series-1)" : "var(--viz-surface)"}
        strokeWidth={2}
      />
      {payload.efficient && (
        <text
          x={labelLeft ? cx - 9 : cx + 9}
          y={cy - 8}
          textAnchor={labelLeft ? "end" : "start"}
          fontSize={11}
          fill="var(--viz-ink)"
        >
          {payload.label}
        </text>
      )}
    </a>
  );
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let value = 0; value < max + step * 0.999; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}
