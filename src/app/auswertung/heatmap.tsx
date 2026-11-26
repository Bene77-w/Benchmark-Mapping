"use client";

import { useRef, useState } from "react";
import type { Heatmap, HeatmapCell, HeatmapRow } from "@/server/analysis/views";
import { HARNESS_LABELS } from "@/server/harness/adapter";
import type { Category } from "@/server/scoring/model";
import { CATEGORY_LABELS, formatScore, MODE_LABELS } from "../laeufe/labels";

/** Stufen der sequentiellen Rampe (`--viz-seq-1` … `--viz-seq-7`). */
const STEPS = 7;
const CELL = 22;

const ERROR_LABELS: Record<Exclude<HeatmapCell["kind"], "score">, string> = {
  format_error: "Format-Fehler",
  harness_failure: "Harness-Fehler",
};

/** Stufe der Rampe zu einem Unit-Score 0–1 (gleich breite Klassen). */
function step(score: number): number {
  return Math.min(STEPS, Math.floor(score * STEPS) + 1);
}

function stepRange(index: number): string {
  const low = (index - 1) / STEPS;
  const high = index / STEPS;
  return `${low.toFixed(2)}–${high.toFixed(2)}`;
}

/** Schraffur (45°) für Fehlerzellen: Score 0 ohne Mapping-Aussage, nicht nur durch Farbe unterschieden. */
const HATCH =
  "repeating-linear-gradient(45deg, var(--viz-axis) 0 1.5px, transparent 1.5px 5px), var(--viz-surface)";

function cellStyle(cell: HeatmapCell): React.CSSProperties {
  if (cell.kind === "score") return { background: `var(--viz-seq-${step(cell.score)})` };
  return { background: cell.kind === "format_error" ? HATCH : "var(--viz-surface)" };
}

/** Kurzer Spaltenkopf: letzter Teil der unit_id (die volle ID steht im Tooltip). */
function shortUnit(unitId: string): string {
  return unitId.split("--").at(-1) ?? unitId;
}

interface Hover {
  row: HeatmapRow;
  cell: HeatmapCell;
  category: Category;
  left: number;
  top: number;
}

/**
 * Heatmap Läufe × Units: Zeilen in der Reihenfolge der Rangliste, Spalten nach Kategorie. Die Farbe ist der
 * Unit-Score (sequentiell, eine Farbe); Format-Fehler sind schraffiert mit „F“, Harness-Fehler tragen „!“ –
 * beides Score 0, aber erkennbar kein falsches Mapping. Jede Zelle öffnet die Unit-Detailansicht des Laufs.
 */
export function HeatmapView({ heatmap }: { heatmap: Heatmap }) {
  const container = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const groups = heatmap.units.reduce<{ category: Category; count: number }[]>((result, unit) => {
    const last = result.at(-1);
    if (last && last.category === unit.category) last.count += 1;
    else result.push({ category: unit.category, count: 1 });
    return result;
  }, []);

  function show(
    event: React.SyntheticEvent<HTMLElement>,
    row: HeatmapRow,
    cell: HeatmapCell,
    category: Category,
  ) {
    const box = container.current?.getBoundingClientRect();
    const target = event.currentTarget.getBoundingClientRect();
    if (!box) return;
    setHover({
      row,
      cell,
      category,
      left: target.right - box.left,
      top: target.top - box.top + target.height / 2,
    });
  }

  return (
    <figure className="viz-root space-y-2" data-testid="heatmap">
      <Legend />
      <div
        ref={container}
        className="relative overflow-x-auto rounded-md border p-3"
        style={{ background: "var(--viz-surface)" }}
      >
        <table className="border-separate text-xs" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th />
              {groups.map((group) => (
                <th
                  key={group.category}
                  colSpan={group.count}
                  className="border-b px-1 pb-1 text-left font-normal whitespace-nowrap"
                  style={{ color: "var(--viz-ink-secondary)", borderColor: "var(--viz-axis)" }}
                  title={CATEGORY_LABELS[group.category]}
                >
                  {group.count > 2 ? CATEGORY_LABELS[group.category] : group.category}
                </th>
              ))}
            </tr>
            <tr>
              <th />
              {heatmap.units.map((unit) => (
                <th
                  key={unit.unitId}
                  className="h-28 align-bottom font-normal"
                  style={{ width: CELL, color: "var(--viz-muted)" }}
                  title={unit.unitId}
                >
                  <span className="inline-block max-h-28 overflow-hidden text-ellipsis whitespace-nowrap [writing-mode:vertical-rl] rotate-180">
                    {shortUnit(unit.unitId)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.rows.map((row) => {
              const cells = new Map(row.cells.map((cell) => [cell.unitId, cell]));
              return (
                <tr key={row.runId} data-testid="heatmap-row" data-run-id={row.runId}>
                  <th scope="row" className="pr-3 text-left font-normal whitespace-nowrap">
                    <span style={{ color: "var(--viz-ink)" }}>
                      {row.configuration.model} · {row.configuration.effort}
                    </span>{" "}
                    <span className="tabular-nums" style={{ color: "var(--viz-muted)" }}>
                      {formatScore(row.score)}
                    </span>
                  </th>
                  {heatmap.units.map((unit) => {
                    const cell = cells.get(unit.unitId);
                    if (!cell) return <td key={unit.unitId} />;
                    const label =
                      cell.kind === "score"
                        ? `Score ${formatScore(cell.score, 2)}`
                        : `${ERROR_LABELS[cell.kind]} (${cell.errorKind ?? "–"}), Score 0`;
                    return (
                      <td key={unit.unitId} className="p-0">
                        <a
                          href={`/laeufe/${row.runId}/units/${encodeURIComponent(unit.unitId)}`}
                          data-testid="heatmap-cell"
                          data-unit-id={unit.unitId}
                          data-kind={cell.kind}
                          data-score={cell.score}
                          aria-label={`${row.configuration.model} · ${row.configuration.effort}, ${unit.unitId}: ${label}`}
                          className="flex items-center justify-center rounded-[3px] font-semibold outline-offset-1"
                          style={{ ...cellStyle(cell), width: CELL, height: CELL, color: "var(--viz-ink)" }}
                          onMouseEnter={(event) => show(event, row, cell, unit.category)}
                          onFocus={(event) => show(event, row, cell, unit.category)}
                          onMouseLeave={() => setHover(null)}
                          onBlur={() => setHover(null)}
                        >
                          {cell.kind === "format_error" ? "F" : cell.kind === "harness_failure" ? "!" : null}
                        </a>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {hover && <Tooltip hover={hover} />}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Zeile = Lauf, Spalte = Unit. Klick öffnet die Antwort.
      </figcaption>
    </figure>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        Unit-Score 0
        <span className="inline-flex gap-px">
          {Array.from({ length: STEPS }, (_, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: feste Stufen der Rampe
              key={index}
              className="inline-block h-3 w-4"
              style={{ background: `var(--viz-seq-${index + 1})` }}
              title={stepRange(index + 1)}
            />
          ))}
        </span>
        1
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border text-[10px] font-semibold"
          style={{ background: HATCH, color: "var(--viz-ink)" }}
        >
          F
        </span>
        Format-Fehler (Timeout, ungültiges JSON, Schemaverstoß; Score 0)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border text-[10px] font-semibold"
          style={{ background: "var(--viz-surface)", color: "var(--viz-ink)" }}
        >
          !
        </span>
        Harness-Fehler (Score 0)
      </span>
    </div>
  );
}

function Tooltip({ hover }: { hover: Hover }) {
  const { row, cell, category } = hover;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-md border bg-popover px-3 py-2 text-xs shadow-sm"
      style={{ left: hover.left, top: hover.top, transform: "translate(8px, -50%)" }}
    >
      <div className="font-medium">{cell.unitId}</div>
      <div className="text-muted-foreground">{CATEGORY_LABELS[category]}</div>
      <div className="mt-1">
        {row.configuration.model} · {row.configuration.effort}
      </div>
      <div className="text-muted-foreground">
        {HARNESS_LABELS[row.configuration.harness]} · {MODE_LABELS[row.configuration.mode]} · Lauf #
        {row.runId}
      </div>
      <div className="mt-1 tabular-nums">
        {cell.kind === "score"
          ? `Unit-Score ${formatScore(cell.score, 2)}`
          : `${ERROR_LABELS[cell.kind]}: ${cell.errorKind ?? "–"} (Score 0)`}
      </div>
    </div>
  );
}
