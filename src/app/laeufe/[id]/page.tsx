import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { getActiveGold } from "@/server/gold/active";
import { estimateRunCost } from "@/server/pricing/cost";
import { getPriceTable } from "@/server/pricing/store";
import type { UnitResultView } from "@/server/runs/model";
import { getRun } from "@/server/runs/store";
import { type RunEvaluation, VIOLATION_KINDS } from "@/server/scoring/model";
import { ensureEvaluation, listEvaluations, type StoredEvaluation } from "@/server/scoring/store";
import { cancelRunAction, resumeRunAction, supplementRunAction } from "../actions";
import {
  CATEGORY_LABELS,
  configurationLabel,
  formatDateTime,
  formatPercent,
  formatScore,
  RUN_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  VIOLATION_LABELS,
} from "../labels";
import { AutoRefresh } from "./auto-refresh";
import { ESTIMATE_NOTE, nativeCostLabel, RunCostSummary, unitCostLabel } from "./costs";
import { PreflightSection } from "./preflight-section";

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
  const db = getDatabase();
  const run = Number.isInteger(runId) ? await getRun(db, runId) : null;
  if (!run) notFound();
  const costs = estimateRunCost(run, await getPriceTable(db));
  const gold = await getActiveGold(db);
  const evaluation = gold ? await ensureEvaluation(db, run.id, gold) : null;
  const stored = await listEvaluations(db, run.id);
  const unitEvaluations = new Map((evaluation?.units ?? []).map((unit) => [unit.unitId, unit]));
  const active = run.status === "queued" || run.status === "running";
  // Ergänzen mit derselben Konfiguration: nur die Units der aktuellen Gold-Version ohne Ergebnis werden aufgerufen.
  const canSupplement =
    run.kind === "benchmark" &&
    (run.status === "completed" || run.status === "failed") &&
    evaluation !== null &&
    !evaluation.complete;
  const { progress } = run;

  return (
    <div className="space-y-6">
      <AutoRefresh active={active} />
      <h1 className="text-2xl font-semibold">Lauf #{run.id}</h1>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Konfiguration</dt>
        <dd data-testid="run-configuration">{configurationLabel(run.configuration)}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="flex flex-wrap items-center gap-3">
          <span data-testid="run-status">{RUN_STATUS_LABELS[run.status]}</span>
          {run.error && <span className="text-destructive">{run.error}</span>}
          {active && (
            <form action={cancelRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" variant="outline" size="sm">
                Abbrechen
              </Button>
            </form>
          )}
          {canSupplement && (
            <form action={supplementRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" variant="outline" size="sm" data-testid="run-supplement">
                Fehlende Units ergänzen ({evaluation?.missingUnitIds.length})
              </Button>
            </form>
          )}
          {run.status === "cancelled" && (
            <form action={resumeRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" variant="outline" size="sm">
                Fortsetzen
              </Button>
            </form>
          )}
        </dd>
        {run.rateLimitedUntil && (
          <>
            <dt className="text-muted-foreground">Ratenlimit</dt>
            <dd data-testid="run-rate-limit">
              Alle Aufrufe warten; nächste Nachfrage um {formatDateTime(run.rateLimitedUntil)}
            </dd>
          </>
        )}
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

      <PreflightSection preflight={run.preflight} />

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

      {evaluation ? (
        <EvaluationSection evaluation={evaluation} completed={run.status === "completed"} stored={stored} />
      ) : (
        <p className="text-sm text-muted-foreground">Keine Bewertung: Es gibt noch keine Gold-Version.</p>
      )}

      <RunCostSummary costs={costs} model={run.configuration.model} />

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Units</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead>Kategorie</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Versuche</TableHead>
              <TableHead title="Effort laut Harness; bestätigt nur, wenn der Harness die angeforderte Stufe gemeldet hat">
                Effort
              </TableHead>
              <TableHead>Antwort</TableHead>
              <TableHead className="text-right">Unit-Score</TableHead>
              <TableHead className="text-right">Regelverstöße</TableHead>
              <TableHead className="text-right">Tokens (in / cache / out)</TableHead>
              <TableHead className="text-right" title={ESTIMATE_NOTE}>
                Kosten (geschätzt)
              </TableHead>
              <TableHead className="text-right">Kosten (nativ)</TableHead>
              <TableHead className="text-right">Dauer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.units.map((unit) => {
              const scored = unitEvaluations.get(unit.unitId);
              return (
                <TableRow key={unit.unitId} data-testid="unit-row">
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/laeufe/${run.id}/units/${encodeURIComponent(unit.unitId)}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {unit.unitId}
                    </Link>
                  </TableCell>
                  <TableCell>{scored ? scored.category : "nicht im Gold"}</TableCell>
                  <TableCell>{UNIT_STATUS_LABELS[unit.status]}</TableCell>
                  <TableCell className="text-right" data-testid="unit-attempts">
                    {unit.attempts}
                  </TableCell>
                  <TableCell data-testid="unit-effort">{effortLabel(unit)}</TableCell>
                  <TableCell className="max-w-md truncate">{answerLabel(unit)}</TableCell>
                  <TableCell className="text-right" data-testid="unit-score">
                    {formatScore(scored?.score, 2)}
                  </TableCell>
                  <TableCell className="text-right" data-testid="unit-violations">
                    {scored && scored.status === "answer" ? scored.violations.length : "–"}
                  </TableCell>
                  <TableCell className="text-right">{tokensLabel(unit)}</TableCell>
                  <TableCell className="text-right" data-testid="unit-cost-estimated">
                    {unitCostLabel(costs.units[unit.unitId])}
                  </TableCell>
                  <TableCell className="text-right" data-testid="unit-cost-native">
                    {nativeCostLabel(unit)}
                  </TableCell>
                  <TableCell className="text-right">
                    {unit.durationMs === null ? "–" : `${(unit.durationMs / 1000).toFixed(1)} s`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function EvaluationSection({
  evaluation,
  completed,
  stored,
}: {
  evaluation: RunEvaluation;
  completed: boolean;
  stored: StoredEvaluation[];
}) {
  const violationTotal = VIOLATION_KINDS.reduce((sum, kind) => sum + evaluation.violations[kind], 0);
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">
        Bewertung gegen <span data-testid="evaluation-gold">{evaluation.goldVersion}</span>
      </h2>
      <div className="text-sm">
        {!completed ? (
          <span className="text-muted-foreground">Score erst nach Abschluss des Laufs</span>
        ) : !evaluation.complete ? (
          <span className="text-destructive" data-testid="run-incomplete">
            unvollständig für {evaluation.goldVersion} und deshalb aus der Auswertung ausgeblendet: kein
            Ergebnis für {evaluation.missingUnitIds.join(", ")}
          </span>
        ) : (
          <>
            <span data-testid="run-score" className="text-xl font-semibold">
              {formatScore(evaluation.score)}
            </span>{" "}
            <span data-testid="run-interval" className="text-muted-foreground">
              {evaluation.interval
                ? `± Bootstrap-Intervall ${formatScore(evaluation.interval.low)}–${formatScore(evaluation.interval.high)} (${evaluation.bootstrap.confidence * 100} %, ${evaluation.bootstrap.samples} Stichproben, Seed ${evaluation.bootstrap.seed})`
                : ""}
            </span>
          </>
        )}
      </div>
      <dl className="flex flex-wrap gap-6 text-sm">
        <Count label="Format-Fehler" value={evaluation.formatErrors} testId="run-format-errors" />
        <Count label="Harness-Fehler" value={evaluation.harnessFailures} testId="run-harness-failures" />
        <Count label="Regelverstöße" value={violationTotal} testId="run-violations" />
        <Count
          label="Evidence-Treue"
          value={formatPercent(evaluation.evidenceFidelity)}
          testId="run-evidence-fidelity"
        />
      </dl>
      <div className="grid gap-6 md:grid-cols-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Regelverstoß</TableHead>
              <TableHead className="text-right">Anzahl</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {VIOLATION_KINDS.map((kind) => (
              <TableRow key={kind} data-testid="violation-row">
                <TableCell>{VIOLATION_LABELS[kind]}</TableCell>
                <TableCell className="text-right">{evaluation.violations[kind]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kategorie</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evaluation.categories.map((entry) => (
              <TableRow key={entry.category} data-testid="category-row">
                <TableCell>{CATEGORY_LABELS[entry.category]}</TableCell>
                <TableCell className="text-right">{entry.unitCount}</TableCell>
                <TableCell className="text-right">{completed ? formatScore(entry.score) : "–"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {stored.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Gespeicherte Bewertungen:{" "}
          {stored
            .map(
              (entry) =>
                `${entry.goldVersion} (${entry.scoringVersion}, ${entry.complete ? formatScore(entry.score) : "unvollständig"}, ${formatDateTime(entry.evaluatedAt)})`,
            )
            .join(" · ")}
        </p>
      )}
    </section>
  );
}

function Count({ label, value, testId }: { label: string; value: number | string; testId: string }) {
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

function effortLabel(unit: UnitResultView): string {
  if (!unit.effort) return "–";
  return `${unit.effort.reported ?? "–"} (${unit.effort.confirmed ? "bestätigt" : "unbestätigt"})`;
}
