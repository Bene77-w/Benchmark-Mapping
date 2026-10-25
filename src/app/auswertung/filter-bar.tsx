import { cn } from "cn";
import Link from "next/link";
import {
  type Analysis,
  type AnalysisState,
  analysisSearch,
  EFFORT_FILTERS,
  type EffortFilter,
  X_AXES,
} from "@/server/analysis/leaderboard";
import { MODES } from "@/server/prompt/benchmark-prompt";
import { MODE_LABELS } from "../laeufe/labels";
import { X_AXIS_LABELS } from "./format";

const EFFORT_LABELS: Record<EffortFilter, string> = {
  all: "alle Stufen",
  best: "beste Stufe je Modell",
};

/** Adresse der Auswertungsseite mit geändertem Zustand; Filter bleiben beim Umschalten erhalten. */
export function analysisHref(
  state: AnalysisState,
  change: Partial<AnalysisState["filters"]> & Partial<Omit<AnalysisState, "filters">>,
) {
  const { xAxis, categoryRuns, historyConfiguration, ...filters } = change;
  return `/auswertung?${analysisSearch({
    filters: { ...state.filters, ...filters },
    xAxis: xAxis ?? state.xAxis,
    categoryRuns: categoryRuns ?? state.categoryRuns,
    historyConfiguration:
      historyConfiguration === undefined ? state.historyConfiguration : historyConfiguration,
  })}`;
}

/**
 * Filter in einer Zeile über allen Ansichten der Auswertung; der Zustand steht in der Adresse, damit
 * weitere Ansichten (Kategorien, Heatmap, Verlauf) dieselben Filter lesen.
 */
export function FilterBar({ analysis, state }: { analysis: Analysis; state: AnalysisState }) {
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3 text-sm" data-testid="analysis-filters">
      {analysis.groups.length > 1 && (
        <FilterGroup label="Prompt und Snapshot">
          {analysis.groups.map((group) => (
            <FilterLink
              key={group.key}
              href={analysisHref(state, { group: group.key })}
              active={group.key === state.filters.group}
              title={`Prompt-Hash ${group.promptHash}, Snapshot-Hash ${group.snapshotHash}`}
            >
              {group.promptVersion} · {group.promptHash.slice(0, 8)} / {group.snapshotHash.slice(0, 8)} (
              {group.runCount})
            </FilterLink>
          ))}
        </FilterGroup>
      )}
      <FilterGroup label="Modus">
        {MODES.map((mode) => (
          <FilterLink
            key={mode}
            href={analysisHref(state, { mode })}
            active={mode === state.filters.mode}
            disabled={!analysis.modes.includes(mode)}
          >
            {MODE_LABELS[mode]}
          </FilterLink>
        ))}
      </FilterGroup>
      <FilterGroup label="Effort">
        {EFFORT_FILTERS.map((effort) => (
          <FilterLink
            key={effort}
            href={analysisHref(state, { effort })}
            active={effort === state.filters.effort}
          >
            {EFFORT_LABELS[effort]}
          </FilterLink>
        ))}
      </FilterGroup>
      <FilterGroup label="x-Achse">
        {X_AXES.map((xAxis) => (
          <FilterLink key={xAxis} href={analysisHref(state, { xAxis })} active={xAxis === state.xAxis}>
            {X_AXIS_LABELS[xAxis]}
          </FilterLink>
        ))}
      </FilterGroup>
    </div>
  );
}

export function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Gruppe von Links, kein Formular
    <div role="group" aria-label={label} className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** Umschalter als Link (Filter und Auswahl der Ansichten); `data-*`-Attribute werden durchgereicht. */
export function FilterLink({
  href,
  active,
  disabled = false,
  title,
  children,
  ...data
}: {
  href: string;
  active: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  [attribute: `data-${string}`]: string | number | undefined;
}) {
  const className = cn(
    "rounded-md border px-2.5 py-1",
    active ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
    disabled && "pointer-events-none opacity-40",
  );
  if (disabled) {
    return (
      <span className={className} title={title} aria-disabled="true" {...data}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={className}
      aria-current={active ? "true" : undefined}
      title={title}
      scroll={false}
      {...data}
    >
      {children}
    </Link>
  );
}
