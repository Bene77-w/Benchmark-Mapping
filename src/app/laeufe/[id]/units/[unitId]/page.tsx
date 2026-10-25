import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { getActiveGold } from "@/server/gold/active";
import { type CostEstimate, estimateRunCost } from "@/server/pricing/cost";
import { formatUsd } from "@/server/pricing/format";
import { getPriceTable } from "@/server/pricing/store";
import type { UnitResultView } from "@/server/runs/model";
import { getRun } from "@/server/runs/store";
import type { GoldUnit, UnitEvaluation, Violation } from "@/server/scoring/model";
import { ensureEvaluation } from "@/server/scoring/store";
import type { Industry } from "@/server/snapshot/model";
import { getSnapshotContent } from "@/server/snapshot/store";
import {
  CATEGORY_LABELS,
  configurationLabel,
  formatDateTime,
  formatScore,
  MODE_LABELS,
  missingMeasurementLabel,
  UNIT_EVALUATION_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  VIOLATION_LABELS,
} from "../../../labels";
import { ESTIMATE_NOTE, nativeCostLabel } from "../../costs";

export const metadata = { title: "Unit-Ergebnis – Benchmark-Mapping" };

export default function UnitResultPage({ params }: PageProps<"/laeufe/[id]/units/[unitId]">) {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Lade Unit-Ergebnis …</p>}>
      <UnitResultDetail params={params} />
    </Suspense>
  );
}

async function UnitResultDetail({ params }: Pick<PageProps<"/laeufe/[id]/units/[unitId]">, "params">) {
  const { id, unitId: rawUnitId } = await params;
  const unitId = decodeURIComponent(rawUnitId);
  const runId = Number(id);
  const db = getDatabase();
  const run = Number.isInteger(runId) ? await getRun(db, runId) : null;
  const result = run?.units.find((unit) => unit.unitId === unitId);
  if (!run || !result) notFound();
  const gold = await getActiveGold(db);
  const [evaluation, snapshot, prices] = await Promise.all([
    gold ? ensureEvaluation(db, run.id, gold) : null,
    getSnapshotContent(db, run.snapshotId),
    getPriceTable(db),
  ]);
  // Wie auf der Lauf-Seite: Schätzung über den ganzen Lauf, davon diese Unit.
  const cost = estimateRunCost(run, prices).units[unitId] ?? null;
  const source = snapshot?.units.find((unit) => unit.unitId === unitId);
  if (!snapshot || !source) notFound();
  const industries = new Map(snapshot.industries.map((industry) => [industry.industryId, industry]));
  const goldUnit = gold?.units.find((unit) => unit.unitId === unitId) ?? null;
  const scored = evaluation?.units.find((unit) => unit.unitId === unitId) ?? null;
  const mode = run.configuration.mode;

  return (
    <div className="space-y-6">
      <Link href={`/laeufe/${run.id}`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Lauf #{run.id}
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{source.unitName}</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono text-xs">{unitId}</span> · Lauf #{run.id} ·{" "}
          {configurationLabel(run.configuration)}
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Unit-Score</dt>
        <dd data-testid="unit-detail-score" className="text-xl font-semibold">
          {scored ? formatScore(scored.score) : "nicht im Gold"}
        </dd>
        <dt className="text-muted-foreground">Bewertung</dt>
        <dd data-testid="unit-detail-status">
          {scored ? UNIT_EVALUATION_STATUS_LABELS[scored.status] : "–"} gegen{" "}
          {evaluation?.goldVersion ?? "– (keine Gold-Version)"} ({MODE_LABELS[mode]})
        </dd>
        <dt className="text-muted-foreground">Kategorie</dt>
        <dd>{goldUnit ? CATEGORY_LABELS[goldUnit.category] : "–"}</dd>
        <dt className="text-muted-foreground">Status / Versuche</dt>
        <dd>
          {UNIT_STATUS_LABELS[result.status]} / {result.attempts}
          {result.error && (
            <span className="text-destructive">
              {" "}
              – {result.error.kind}
              {result.error.message ? `: ${result.error.message}` : ""}
              {result.error.rateLimitResetAt ? ` (bis ${formatDateTime(result.error.rateLimitResetAt)})` : ""}
            </span>
          )}
        </dd>
      </dl>

      {result.warnings.length > 0 && (
        <Section title="Vermerke">
          <ul
            className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400"
            data-testid="unit-detail-warnings"
          >
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Das Ergebnis der Unit bleibt gültig.</p>
        </Section>
      )}

      <Section title="Kosten">
        <UnitCosts cost={cost} result={result} model={run.configuration.model} />
      </Section>

      <Section title="Antwort">
        <AnswerView result={result} scored={scored} goldUnit={goldUnit} industries={industries} mode={mode} />
      </Section>

      <Section title="Gold">
        <GoldView goldUnit={goldUnit} industries={industries} mode={mode} />
      </Section>

      {scored && (
        <Section title="Abweichungen">
          <Deviations scored={scored} industries={industries} />
        </Section>
      )}

      <Section title="Regelverstöße">
        <ViolationList violations={scored?.violations ?? []} />
      </Section>

      <Section title="Quelle (Evidence)">
        <p className="text-sm">
          <span className="text-muted-foreground">Name der Unit:</span> {source.unitName}
        </p>
        {source.jurisdictionText === null ? (
          <p className="text-sm italic text-muted-foreground">Kein Zuständigkeitstext (name_only).</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm" data-testid="unit-detail-text">
            {source.jurisdictionText}
          </p>
        )}
      </Section>

      <Section title="Metadaten">
        <Metadata result={result} />
      </Section>

      <Section title="Rohantwort">
        <Raw testId="unit-detail-raw" text={result.rawResponse} />
      </Section>
      <Section title="CLI-Protokoll">
        <Raw testId="unit-detail-log" text={result.log} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

function industryLabel(industries: ReadonlyMap<string, Industry>, industryId: string): string {
  const industry = industries.get(industryId);
  return industry ? `${industry.industryName} (${industryId})` : `${industryId} (unbekannt)`;
}

function goldClassLabel(goldUnit: GoldUnit | null, industryId: string, mode: string): string {
  const entry = goldUnit?.industries.find((industry) => industry.industryId === industryId);
  if (!entry) return goldUnit ? "nicht im Gold" : "–";
  if (entry.webOnly && mode === "text_only") return `${entry.class}, web_only → vertretbar`;
  return entry.webOnly ? `${entry.class}, web_only` : entry.class;
}

function AnswerView({
  result,
  scored,
  goldUnit,
  industries,
  mode,
}: {
  result: UnitResultView;
  scored: UnitEvaluation | null;
  goldUnit: GoldUnit | null;
  industries: ReadonlyMap<string, Industry>;
  mode: string;
}) {
  const { answer } = result;
  if (!answer) return <p className="text-sm text-muted-foreground">Keine schemakonforme Antwort.</p>;
  const violationsOf = (index: number) =>
    (scored?.violations ?? []).filter((violation) => violation.assignmentIndex === index);
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">decision</dt>
        <dd data-testid="answer-decision">{answer.decision}</dd>
        <dt className="text-muted-foreground">no_mapping_reason</dt>
        <dd>{answer.no_mapping_reason ?? "–"}</dd>
        <dt className="text-muted-foreground">broad_scope_exception</dt>
        <dd>
          {answer.broad_scope_exception ? "ja" : "nein"}
          {answer.broad_scope_reason ? ` – ${answer.broad_scope_reason}` : ""}
        </dd>
        <dt className="text-muted-foreground">label_uncertain</dt>
        <dd>
          {answer.label_uncertain ? "ja" : "nein"}
          {answer.uncertainty_note ? ` – ${answer.uncertainty_note}` : ""}
        </dd>
      </dl>
      {answer.assignments.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Industry</TableHead>
              <TableHead>Gold-Klasse</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Begründung</TableHead>
              <TableHead>Verstöße</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {answer.assignments.map((assignment, index) => (
              // Zuordnungen haben keine eigene ID; die Position ist stabil.
              // biome-ignore lint/suspicious/noArrayIndexKey: Reihenfolge der Antwort
              <TableRow key={index} data-testid="assignment-row">
                <TableCell>{industryLabel(industries, assignment.industry_id)}</TableCell>
                <TableCell>{goldClassLabel(goldUnit, assignment.industry_id, mode)}</TableCell>
                <TableCell className="max-w-sm whitespace-normal">„{assignment.evidence_excerpt}“</TableCell>
                <TableCell className="max-w-sm whitespace-normal">{assignment.rationale_short}</TableCell>
                <TableCell className="whitespace-normal">
                  {violationsOf(index).map((violation) => (
                    <Badge key={violation.kind} variant="destructive" className="mr-1">
                      {VIOLATION_LABELS[violation.kind]}
                    </Badge>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {answer.sources.length > 0 && (
        <div>
          <p className="text-muted-foreground">sources</p>
          <ul className="list-disc pl-5">
            {answer.sources.map((entry) => (
              <li key={entry.url}>
                <span className="break-all">{entry.url}</span> – {entry.belegt}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GoldView({
  goldUnit,
  industries,
  mode,
}: {
  goldUnit: GoldUnit | null;
  industries: ReadonlyMap<string, Industry>;
  mode: string;
}) {
  if (!goldUnit) return <p className="text-sm text-muted-foreground">Die Unit gehört nicht zum Gold.</p>;
  if (goldUnit.noMapping)
    return (
      <p className="text-sm" data-testid="gold-no-mapping">
        no_mapping
      </p>
    );
  return (
    <ul className="space-y-1 text-sm" data-testid="gold-industries">
      {goldUnit.industries.map((entry) => (
        <li key={entry.industryId}>
          {industryLabel(industries, entry.industryId)} –{" "}
          <span className="font-medium">{goldClassLabel(goldUnit, entry.industryId, mode)}</span>
        </li>
      ))}
    </ul>
  );
}

function Deviations({
  scored,
  industries,
}: {
  scored: UnitEvaluation;
  industries: ReadonlyMap<string, Industry>;
}) {
  const rows: [string, string[], string][] = [
    ["positiv getroffen", scored.deviations.matchedPositive, "deviation-matched"],
    ["positiv fehlt", scored.deviations.missingPositive, "deviation-missing"],
    ["vertretbar genannt", scored.deviations.namedAcceptable, "deviation-acceptable"],
    ["falsch genannt", scored.deviations.namedWrong, "deviation-wrong"],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
      {rows.map(([label, ids, testId]) => (
        <div key={testId} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd data-testid={testId}>
            {ids.length === 0 ? "–" : ids.map((id) => industryLabel(industries, id)).join(", ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ViolationList({ violations }: { violations: Violation[] }) {
  if (violations.length === 0) return <p className="text-sm text-muted-foreground">Keine.</p>;
  return (
    <ul className="list-disc pl-5 text-sm" data-testid="unit-detail-violations">
      {violations.map((violation, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Verstöße haben keine eigene ID
        <li key={index}>
          {VIOLATION_LABELS[violation.kind]}
          {violation.assignmentIndex === null
            ? ""
            : ` (Zuordnung ${violation.assignmentIndex + 1}: ${violation.industryId})`}
        </li>
      ))}
    </ul>
  );
}

function UnitCosts({
  cost,
  result,
  model,
}: {
  cost: CostEstimate | null;
  result: UnitResultView;
  model: string;
}) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm" data-testid="unit-detail-costs">
      <div>
        <dt className="text-muted-foreground">Geschätzte Kosten ({ESTIMATE_NOTE})</dt>
        <dd className="text-xl font-semibold" data-testid="unit-detail-cost-estimated">
          {cost === null ? "–" : cost.kind === "estimated" ? formatUsd(cost.usd) : "unbekannt"}
        </dd>
        {cost?.kind === "unknown" && (
          <dd className="text-muted-foreground" data-testid="unit-detail-cost-unknown">
            {cost.reason}.{" "}
            <Link href={`/modelle?${new URLSearchParams({ modell: model })}`} className="underline">
              Preis pflegen
            </Link>
          </dd>
        )}
      </div>
      <div>
        <dt className="text-muted-foreground">Native Kosten laut Harness (Gegenprobe)</dt>
        <dd className="text-xl font-semibold" data-testid="unit-detail-cost-native">
          {nativeCostLabel(result)}
        </dd>
      </div>
    </dl>
  );
}

function Metadata({ result }: { result: UnitResultView }) {
  const rows: [string, string][] = [
    ["Modell laut Harness", result.modelReported ?? "–"],
    ["CLI-Version", result.cliVersion ?? "–"],
    [
      "Effort laut Harness",
      result.effort
        ? `${result.effort.reported ?? "–"} (${result.effort.confirmed ? "bestätigt" : "unbestätigt"})`
        : "–",
    ],
    [
      "Tokens (input / cache read / cache write / output / reasoning)",
      result.tokens
        ? `${result.tokens.inputTokens} / ${result.tokens.cacheReadTokens} / ${result.tokens.cacheWriteTokens} / ${result.tokens.outputTokens} / ${result.tokens.reasoningTokens ?? "–"}`
        : missingMeasurementLabel(result),
    ],
    ...(result.tokensByModel
      ? Object.entries(result.tokensByModel).map(([model, tokens]): [string, string] => [
          `Tokens ${model}`,
          `${tokens.inputTokens} / ${tokens.cacheReadTokens} / ${tokens.cacheWriteTokens} / ${tokens.outputTokens} / ${tokens.reasoningTokens ?? "–"}`,
        ])
      : []),
    ["Websuchen", result.webSearches === null ? missingMeasurementLabel(result) : String(result.webSearches)],
    ["Dauer", result.durationMs === null ? "–" : `${(result.durationMs / 1000).toFixed(1)} s`],
    ["Exit-Code", result.exitCode === null ? "–" : String(result.exitCode)],
    ["Gestartet / beendet", `${formatDateTime(result.startedAt)} / ${formatDateTime(result.finishedAt)}`],
    ["Unit-Prompt-Hash", result.unitPromptHash ?? "–"],
  ];
  return (
    <dl
      className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]"
      data-testid="unit-detail-meta"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Raw({ text, testId }: { text: string | null; testId: string }) {
  if (!text) return <p className="text-sm text-muted-foreground">–</p>;
  return (
    <pre
      data-testid={testId}
      className="max-h-96 overflow-auto rounded-lg border bg-muted p-3 text-xs whitespace-pre-wrap break-all"
    >
      {text}
    </pre>
  );
}
