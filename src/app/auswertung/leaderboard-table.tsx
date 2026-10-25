import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AnalysisEntry } from "@/server/analysis/leaderboard";
import { HARNESS_LABELS } from "@/server/harness/adapter";
import { ESTIMATE_NOTE } from "../laeufe/[id]/costs";
import { formatDateTime, formatScore, MODE_LABELS } from "../laeufe/labels";
import { costLabel, durationLabel, tokensLabel } from "./format";

/** Rangliste: ein Lauf je Zeile, absteigend nach Score; Klick führt zur Lauf-Detailansicht. */
export function LeaderboardTable({ entries }: { entries: AnalysisEntry[] }) {
  return (
    <Table data-testid="leaderboard">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Konfiguration</TableHead>
          <TableHead className="text-right">Score ± Intervall</TableHead>
          <TableHead className="text-right" title={ESTIMATE_NOTE}>
            Kosten/Unit*
          </TableHead>
          <TableHead className="text-right">Tokens/Unit</TableHead>
          <TableHead className="text-right">Dauer/Unit</TableHead>
          <TableHead className="text-right">Format-Fehler</TableHead>
          <TableHead className="text-right">Regelverstöße</TableHead>
          <TableHead>Lauf</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry, index) => {
          const href = `/laeufe/${entry.runId}`;
          const { configuration } = entry;
          return (
            <TableRow
              key={entry.runId}
              data-testid="leaderboard-row"
              data-run-id={entry.runId}
              data-score={entry.score}
            >
              <TableCell className="tabular-nums">{index + 1}</TableCell>
              <TableCell>
                <Link href={href} className="font-medium underline-offset-4 hover:underline">
                  {configuration.model} · {configuration.effort}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {HARNESS_LABELS[configuration.harness]} · {MODE_LABELS[configuration.mode]}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <span className="font-medium">{formatScore(entry.score)}</span>
                {entry.interval && (
                  <div className="text-xs text-muted-foreground">
                    {formatScore(entry.interval.low)}–{formatScore(entry.interval.high)}
                  </div>
                )}
              </TableCell>
              <TableCell
                className="text-right tabular-nums"
                data-testid="leaderboard-cost"
                title={
                  entry.costPerUnit.kind === "unknown" ? entry.costPerUnit.reasons.join("; ") : undefined
                }
              >
                {entry.costPerUnit.kind === "unknown" ? (
                  <span className="text-muted-foreground italic">unbekannt</span>
                ) : (
                  costLabel(entry.costPerUnit)
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{tokensLabel(entry.tokensPerUnit)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {durationLabel(entry.durationPerUnitMs)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {entry.formatErrors}
                {entry.harnessFailures > 0 && (
                  <div className="text-xs text-muted-foreground">+{entry.harnessFailures} Harness-Fehler</div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{entry.violations}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <Link href={href} className="underline-offset-4 hover:underline">
                  #{entry.runId}
                </Link>
                <div>{formatDateTime(entry.createdAt)}</div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
