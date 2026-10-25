"use client";

// PROTOTYP – wegwerfen (Branch prototyp/diagramme): Verlauf je Konfiguration wie `score-history.tsx`, aber mit
// Recharts.

import { CartesianGrid, ErrorBar, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { ScoreHistoryPoint } from "@/server/analysis/views";
import { formatScore } from "../laeufe/labels";

const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const DAY_MS = 86_400_000;

function tickLabel(date: Date, short: boolean): string {
  return short
    ? date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function dateTimeLabel(date: Date): string {
  return date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

interface Row {
  runId: number;
  time: number;
  createdAt: Date;
  score: number;
  interval: ScoreHistoryPoint["interval"];
  error: [number, number] | null;
}

export function PrototypeRechartsScoreHistory({
  points,
  label,
}: {
  points: ScoreHistoryPoint[];
  label: string;
}) {
  const data: Row[] = points.map((point) => ({
    runId: point.runId,
    time: point.createdAt.getTime(),
    createdAt: point.createdAt,
    score: point.score,
    interval: point.interval,
    error: point.interval ? [point.score - point.interval.low, point.interval.high - point.score] : null,
  }));
  const times = data.map((row) => row.time);
  let start = Math.min(...times);
  let end = Math.max(...times);
  if (end - start < DAY_MS) {
    const middle = (start + end) / 2;
    start = middle - DAY_MS / 2;
    end = middle + DAY_MS / 2;
  }
  const xTicks = [0, 1 / 3, 2 / 3, 1].map((fraction) => start + fraction * (end - start));

  return (
    <figure className="viz-root space-y-2" data-testid="history-chart">
      <div className="rounded-md border" style={{ background: "var(--viz-surface)" }}>
        <LineChart
          responsive
          style={{ width: "100%", aspectRatio: 760 / 260 }}
          data={data}
          margin={{ top: 16, right: 32, bottom: 8, left: 8 }}
          accessibilityLayer
          title={`Verlauf des Scores: ${label}`}
        >
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis
            type="number"
            dataKey="time"
            scale="time"
            domain={[start, end]}
            ticks={xTicks}
            tickFormatter={(value: number) => tickLabel(new Date(value), end - start <= 3 * DAY_MS)}
            tick={{ fontSize: 11, fill: "var(--viz-muted)" }}
            stroke="var(--viz-axis)"
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
          <Tooltip
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-sm">
                  <div className="font-medium">Lauf #{row.runId}</div>
                  <div className="text-muted-foreground">{dateTimeLabel(row.createdAt)}</div>
                  <div className="mt-1 tabular-nums">
                    Score {formatScore(row.score)}
                    {row.interval && ` (${formatScore(row.interval.low)}–${formatScore(row.interval.high)})`}
                  </div>
                </div>
              );
            }}
          />
          <Line
            dataKey="score"
            name="Score"
            stroke="var(--viz-series-1)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: DotProps) => <PointDot key={props.payload?.runId} {...props} />}
            activeDot={(props: DotProps) => <PointDot key={props.payload?.runId} {...props} active />}
          >
            <ErrorBar
              dataKey="error"
              direction="y"
              width={0}
              stroke="var(--viz-series-1)"
              strokeOpacity={0.5}
            />
          </Line>
        </LineChart>
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

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: Row;
}

/** Punkt als Link zur Lauf-Detailansicht. */
function PointDot({ cx = 0, cy = 0, payload, active = false }: DotProps & { active?: boolean }) {
  if (!payload) return <g />;
  return (
    <a
      href={`/laeufe/${payload.runId}`}
      data-testid="history-point"
      data-run-id={payload.runId}
      aria-label={`Lauf #${payload.runId} vom ${dateTimeLabel(payload.createdAt)}, Score ${formatScore(payload.score)}`}
    >
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={active ? 6 : 5}
        fill="var(--viz-series-1)"
        stroke="var(--viz-surface)"
        strokeWidth={2}
      />
    </a>
  );
}
