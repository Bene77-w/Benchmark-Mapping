import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { readGoldCandidates } from "@/server/gold/candidates";
import { MAX_GOLD_UNITS, toScoringGold } from "@/server/gold/model";
import {
  checkGoldDraft,
  getGoldDraft,
  getGoldProposalRuns,
  getLatestGoldVersion,
  listGoldVersions,
} from "@/server/gold/store";
import { HARNESS_LABELS } from "@/server/harness/adapter";
import { AVAILABLE_HARNESSES } from "@/server/harness/registry";
import {
  DEFAULT_PARALLELISM,
  DEFAULT_TIMEOUT_MS,
  MAX_PARALLELISM,
  MIN_PARALLELISM,
} from "@/server/runs/model";
import { reevaluateAllRuns } from "@/server/scoring/current";
import { CATEGORIES, CATEGORY_LABELS } from "@/server/scoring/model";
import { searchUnits } from "@/server/snapshot/store";
import { AutoRefresh } from "../laeufe/[id]/auto-refresh";
import { configurationLabel, formatDateTime, progressLabel, RUN_STATUS_LABELS } from "../laeufe/labels";
import { ActionForm } from "./action-form";
import {
  addUnitAction,
  adoptRecommendationAction,
  discardDraftAction,
  finalizeAction,
  removeUnitAction,
  startDraftFromVersionAction,
  startProposalRunAction,
} from "./actions";
import { decisionLabel, selectClass } from "./labels";
import { ReevaluationStatusLine } from "./reevaluation-status";

export const metadata = { title: "Gold – Benchmark-Mapping" };

export default function GoldPage() {
  return (
    <div>
      <PageHeader title="Gold" description="Gold-Versionen, Entwurf und Vorschlagsläufe." />
      <Suspense fallback={<p className="text-muted-foreground">Lade Gold …</p>}>
        <GoldContent />
      </Suspense>
    </div>
  );
}

async function GoldContent() {
  await connection();
  const db = getDatabase();
  const [draft, issues, proposalRuns, versions, units, candidates, latest] = await Promise.all([
    getGoldDraft(db),
    checkGoldDraft(db),
    getGoldProposalRuns(db),
    listGoldVersions(db),
    searchUnits(db, {}),
    readGoldCandidates(),
    getLatestGoldVersion(db),
  ]);
  // Die neueste Gold-Version ist die aktuelle; Läufe ohne gültige Bewertung gegen sie werden hier nachbewertet.
  const reevaluation = latest ? await reevaluateAllRuns(db, toScoringGold(latest)) : null;
  const candidateByUnit = new Map(candidates.map((candidate) => [candidate.unitId, candidate]));
  const unitName = new Map(units.map((unit) => [unit.unitId, unit.unitName]));
  const selected = draft?.units ?? [];
  const issuesByUnit = Map.groupBy(
    issues.filter((issue) => issue.unitId !== null),
    (issue) => issue.unitId,
  );
  const active = proposalRuns.some((run) => run.status === "queued" || run.status === "running");

  return (
    <>
      {/* Seltener als auf der Lauf-Seite: die Seite ist groß (alle Units des Snapshots zur Auswahl). */}
      <AutoRefresh active={active} intervalMs={3000} />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Gold-Versionen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="gold-current">
                Noch keine abgeschlossene Gold-Version.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {versions.map((version, index) => (
                  <li key={version.id} data-testid={index === 0 ? "gold-current" : undefined}>
                    <Link
                      href={`/gold/versionen/${version.label}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {version.label}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      eingefroren {formatDateTime(version.frozenAt)}
                      {index === 0 && " (aktuell)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {reevaluation && <ReevaluationStatusLine status={reevaluation} />}
            {latest && !draft && (
              <ActionForm action={startDraftFromVersionAction}>
                <input type="hidden" name="label" value={latest.label ?? ""} />
                <Button type="submit" variant="outline">
                  {latest.label} als Ausgangspunkt bearbeiten
                </Button>
              </ActionForm>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Gold-Entwurf: <span data-testid="draft-count">{selected.length}</span> von {MAX_GOLD_UNITS}{" "}
              Units
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft?.baseLabel && (
              <p className="text-sm text-muted-foreground">
                Ausgangspunkt: <span data-testid="draft-base">{draft.baseLabel}</span>
              </p>
            )}
            <div className="flex flex-wrap items-end gap-4">
              <ActionForm action={addUnitAction} className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1 text-sm">
                  <label htmlFor="gold-unit">Unit</label>
                  <Input id="gold-unit" name="unitId" list="gold-unit-options" className="w-96" required />
                  <datalist id="gold-unit-options">
                    {units.map((unit) => {
                      const candidate = candidateByUnit.get(unit.unitId);
                      return (
                        <option key={unit.unitId} value={unit.unitId}>
                          {candidate ? `${candidate.code} · ` : ""}
                          {unit.unitName}
                        </option>
                      );
                    })}
                  </datalist>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  Kategorie
                  <select name="category" className={selectClass} defaultValue="f">
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit">Unit hinzufügen</Button>
              </ActionForm>
              <ActionForm action={adoptRecommendationAction}>
                <Button type="submit" variant="outline">
                  Empfohlene 30er-Auswahl übernehmen
                </Button>
              </ActionForm>
            </div>

            {selected.length > 0 && (
              <div className="-mx-5 border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Kategorie</TableHead>
                      <TableHead>Entscheidung</TableHead>
                      <TableHead>Prüfung</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.map((unit) => {
                      const candidate = candidateByUnit.get(unit.unitId);
                      const unitIssues = issuesByUnit.get(unit.unitId) ?? [];
                      return (
                        <TableRow key={unit.unitId} data-testid="gold-unit-row">
                          <TableCell>
                            <Link
                              href={`/gold/units/${encodeURIComponent(unit.unitId)}`}
                              className="font-mono text-xs text-primary hover:underline"
                            >
                              {unit.unitId}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {candidate && <Badge variant="outline">{candidate.code}</Badge>}{" "}
                              {unitName.get(unit.unitId)}
                            </div>
                          </TableCell>
                          <TableCell>{CATEGORY_LABELS[unit.category]}</TableCell>
                          <TableCell>{decisionLabel(unit)}</TableCell>
                          <TableCell className="text-xs text-destructive">
                            {unitIssues.map((issue) => issue.message).join("; ")}
                          </TableCell>
                          <TableCell className="text-right">
                            <form action={removeUnitAction}>
                              <input type="hidden" name="unitId" value={unit.unitId} />
                              <Button type="submit" variant="ghost" size="sm">
                                Entfernen
                              </Button>
                            </form>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vorschlagsläufe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ActionForm action={startProposalRunAction} className="space-y-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
                <label className="flex flex-col gap-1 text-sm">
                  Harness
                  <select name="harness" className={selectClass}>
                    {AVAILABLE_HARNESSES.map((harness) => (
                      <option key={harness} value={harness}>
                        {HARNESS_LABELS[harness]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-col gap-1 text-sm">
                  <label htmlFor="proposal-model">Modell</label>
                  <Input id="proposal-model" name="model" required />
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <label htmlFor="proposal-effort">Effort</label>
                  <Input id="proposal-effort" name="effort" required placeholder="höchste Stufe, z. B. max" />
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <label htmlFor="proposal-parallelism">Parallelität</label>
                  <Input
                    id="proposal-parallelism"
                    name="parallelism"
                    type="number"
                    min={MIN_PARALLELISM}
                    max={MAX_PARALLELISM}
                    defaultValue={DEFAULT_PARALLELISM}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <label htmlFor="proposal-timeout">Timeout pro Unit (Minuten)</label>
                  <Input
                    id="proposal-timeout"
                    name="timeoutMinutes"
                    type="number"
                    min={1}
                    defaultValue={DEFAULT_TIMEOUT_MS / 60_000}
                    required
                  />
                </div>
              </div>
              <Button type="submit">Vorschlagslauf starten</Button>
            </ActionForm>
            {proposalRuns.length > 0 && (
              <div className="-mx-5 border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lauf</TableHead>
                      <TableHead>Konfiguration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Units fertig</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proposalRuns.map((run) => (
                      <TableRow key={run.id} data-testid="proposal-run-row">
                        <TableCell>
                          <Link href={`/laeufe/${run.id}`} className="text-primary hover:underline">
                            #{run.id}
                          </Link>
                        </TableCell>
                        <TableCell>{configurationLabel(run.configuration)}</TableCell>
                        <TableCell data-testid="proposal-run-status">
                          {RUN_STATUS_LABELS[run.status]}
                        </TableCell>
                        <TableCell>{progressLabel(run.progress)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Abschluss</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {issues.length === 0 ? (
              <p className="text-sm" data-testid="gold-check">
                Prüfung bestanden
              </p>
            ) : (
              <div data-testid="gold-check" className="space-y-1 text-sm">
                <p>{issues.length} Befunde blockieren den Abschluss:</p>
                <ul className="list-disc pl-5 text-destructive">
                  {issues.map((issue) => (
                    <li key={`${issue.unitId}-${issue.kind}-${issue.message}`}>
                      {issue.unitId && <span className="font-mono text-xs">{issue.unitId}: </span>}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-3">
              <ActionForm action={finalizeAction}>
                <Button type="submit" disabled={issues.length > 0}>
                  Gold-Review abschließen
                </Button>
              </ActionForm>
              {draft && (
                <form action={discardDraftAction}>
                  <Button type="submit" variant="outline">
                    Entwurf verwerfen
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
