import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { readGoldCandidates } from "@/server/gold/candidates";
import { GOLD_CATEGORIES, GOLD_CATEGORY_LABELS, MAX_GOLD_UNITS } from "@/server/gold/model";
import { checkGoldDraft, getGoldDraft, getGoldProposalRuns, listGoldVersions } from "@/server/gold/store";
import { HARNESS_LABELS } from "@/server/harness/adapter";
import { AVAILABLE_HARNESSES } from "@/server/harness/registry";
import {
  DEFAULT_PARALLELISM,
  DEFAULT_TIMEOUT_MS,
  MAX_PARALLELISM,
  MIN_PARALLELISM,
} from "@/server/runs/model";
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
  startProposalRunAction,
} from "./actions";
import { decisionLabel, selectClass } from "./labels";

export const metadata = { title: "Gold – Benchmark-Mapping" };

export default function GoldPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Gold</h1>
      <Suspense fallback={<p className="text-muted-foreground">Lade Gold …</p>}>
        <GoldContent />
      </Suspense>
    </div>
  );
}

async function GoldContent() {
  await connection();
  const db = getDatabase();
  const [draft, issues, proposalRuns, versions, units, candidates] = await Promise.all([
    getGoldDraft(db),
    checkGoldDraft(db),
    getGoldProposalRuns(db),
    listGoldVersions(db),
    searchUnits(db, {}),
    readGoldCandidates(),
  ]);
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
      <AutoRefresh active={active} />
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Gold-Versionen</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="gold-current">
            Noch keine abgeschlossene Gold-Version.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {versions.map((version, index) => (
              <li key={version.id} data-testid={index === 0 ? "gold-current" : undefined}>
                <Link href={`/gold/versionen/${version.label}`} className="underline underline-offset-4">
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
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Gold-Entwurf: <span data-testid="draft-count">{selected.length}</span> von {MAX_GOLD_UNITS} Units
        </h2>
        <p className="text-sm text-muted-foreground">
          Units aus dem Snapshot wählen und kategorisieren. Die Kandidatenliste (
          <code>docs/goldset/kandidaten.md</code>) ist nur eine Hilfe; Kürzel wie „A1“ stehen bei den Units.
        </p>
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
                {GOLD_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {GOLD_CATEGORY_LABELS[category]}
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
                        className="font-mono text-xs underline underline-offset-4"
                      >
                        {unit.unitId}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {candidate && <Badge variant="outline">{candidate.code}</Badge>}{" "}
                        {unitName.get(unit.unitId)}
                      </div>
                    </TableCell>
                    <TableCell>{GOLD_CATEGORY_LABELS[unit.category]}</TableCell>
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
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Vorschlagsläufe</h2>
        <p className="text-sm text-muted-foreground">
          Gold-Brief, immer mit Websuche, über alle Units des Entwurfs. Vorschlagsläufe erscheinen nie in
          Rangliste oder Diagrammen. Beim Fake-Harness ist das Modell ein Szenario (z. B.{" "}
          <code>vorschlag-a</code>).
        </p>
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
                    <Link href={`/laeufe/${run.id}`} className="underline underline-offset-4">
                      #{run.id}
                    </Link>
                  </TableCell>
                  <TableCell>{configurationLabel(run.configuration)}</TableCell>
                  <TableCell data-testid="proposal-run-status">{RUN_STATUS_LABELS[run.status]}</TableCell>
                  <TableCell>{progressLabel(run.progress)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Abschluss</h2>
        {issues.length === 0 ? (
          <p className="text-sm" data-testid="gold-check">
            Prüfung bestanden: Der Abschluss friert den Entwurf als neue Gold-Version ein.
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
      </section>
    </>
  );
}
