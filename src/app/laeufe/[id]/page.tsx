import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { readTestGold } from "@/server/gold/test-gold";
import type { UnitResultView } from "@/server/runs/model";
import { getRun } from "@/server/runs/store";
import { simpleRunScore } from "@/server/scoring/simple-score";
import { configurationLabel, formatDateTime, RUN_STATUS_LABELS, UNIT_STATUS_LABELS } from "../labels";
import { AutoRefresh } from "./auto-refresh";

export const metadata = { title: "Lauf – Benchmark-Mapping" };

export default function RunPage({ params }: PageProps<"/laeufe/[id]">) {
  return (
    <div className="space-y-6">
      <Link href="/laeufe" className="text-sm text-muted-foreground hover:text-foreground">
        ← Alle Läufe
      </Link>
      <Suspense fallback={<p className="text-muted-foreground">Lade Lauf …</p>}>
        <RunDetail params={params} />
      </Suspense>
    </div>
  );
}

async function RunDetail({ params }: Pick<PageProps<"/laeufe/[id]">, "params">) {
  const { id } = await params;
  const runId = Number(id);
  const run = Number.isInteger(runId) ? await getRun(getDatabase(), runId) : null;
  if (!run) notFound();
  const gold = await readTestGold();
  const { score, unitScores } = simpleRunScore(
    new Map(run.units.map((unit) => [unit.unitId, unit.answer])),
    gold.units.filter((unit) => run.units.some((result) => result.unitId === unit.unitId)),
  );
  const active = run.status === "queued" || run.status === "running";
  const { progress } = run;

  return (
    <div className="space-y-6">
      <AutoRefresh active={active} />
      <h1 className="text-2xl font-semibold">Lauf #{run.id}</h1>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Konfiguration</dt>
        <dd data-testid="run-configuration">{configurationLabel(run.configuration)}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd data-testid="run-status">
          {RUN_STATUS_LABELS[run.status]}
          {run.error && <span className="text-destructive"> – {run.error}</span>}
        </dd>
        <dt className="text-muted-foreground">Parallelität / Timeout</dt>
        <dd>
          {run.parallelism} / {run.timeoutMs / 60_000} min pro Unit
        </dd>
        <dt className="text-muted-foreground">Prompt</dt>
        <dd>
          {run.promptVersion} <span className="font-mono text-xs break-all">{run.promptHash}</span>
        </dd>
        <dt className="text-muted-foreground">Ausgabeschema</dt>
        <dd>
          {run.outputSchemaVersion}{" "}
          <span className="font-mono text-xs break-all">{run.outputSchemaHash}</span>
        </dd>
        <dt className="text-muted-foreground">Snapshot-Hash</dt>
        <dd className="font-mono text-xs break-all">{run.snapshotHash}</dd>
        <dt className="text-muted-foreground">Angelegt / beendet</dt>
        <dd>
          {formatDateTime(run.createdAt)} / {formatDateTime(run.finishedAt)}
        </dd>
      </dl>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Fortschritt</h2>
        <dl className="flex flex-wrap gap-6 text-sm">
          <Count label="fertig" value={progress.done} testId="progress-done" />
          <Count label="fehlgeschlagen" value={progress.failed} testId="progress-failed" />
          <Count label="laufend" value={progress.running} testId="progress-running" />
          <Count label="offen" value={progress.pending} testId="progress-pending" />
          <Count label="gesamt" value={progress.total} testId="progress-total" />
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Score</h2>
        <p className="text-sm">
          {run.status === "completed" ? (
            <>
              <span data-testid="run-score" className="text-xl font-semibold">
                {score.toFixed(3)}
              </span>{" "}
              <span className="text-muted-foreground">
                einfache Bewertung (Mittelwert der Unit-F1) gegen {gold.version}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">erst nach Abschluss des Laufs</span>
          )}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Units</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Antwort</TableHead>
              <TableHead className="text-right">Unit-Score</TableHead>
              <TableHead className="text-right">Tokens (in / cache / out)</TableHead>
              <TableHead className="text-right">Dauer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.units.map((unit) => (
              <TableRow key={unit.unitId} data-testid="unit-row">
                <TableCell className="font-mono text-xs">{unit.unitId}</TableCell>
                <TableCell>{UNIT_STATUS_LABELS[unit.status]}</TableCell>
                <TableCell className="max-w-md truncate">{answerLabel(unit)}</TableCell>
                <TableCell className="text-right">
                  {unit.finishedAt && unitScores.has(unit.unitId)
                    ? (unitScores.get(unit.unitId) ?? 0).toFixed(2)
                    : "–"}
                </TableCell>
                <TableCell className="text-right">{tokensLabel(unit)}</TableCell>
                <TableCell className="text-right">
                  {unit.durationMs === null ? "–" : `${(unit.durationMs / 1000).toFixed(1)} s`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function Count({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-testid={testId} className="text-xl font-semibold">
        {value}
      </dd>
    </div>
  );
}

function answerLabel(unit: UnitResultView): string {
  if (unit.error) return `${unit.error.kind}: ${unit.error.message ?? ""}`;
  if (!unit.answer) return "–";
  if (unit.answer.decision === "no_mapping") return "no_mapping";
  return unit.answer.assignments.map((assignment) => assignment.industry_id).join(", ");
}

function tokensLabel(unit: UnitResultView): string {
  if (!unit.tokens) return "–";
  const { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens } = unit.tokens;
  return `${inputTokens} / ${cacheReadTokens + cacheWriteTokens} / ${outputTokens}`;
}
