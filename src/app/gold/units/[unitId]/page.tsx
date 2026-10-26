import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import type { GoldProposal } from "@/server/gold/model";
import { getGoldDraft, getGoldUnitReview } from "@/server/gold/store";
import { HARNESS_LABELS } from "@/server/harness/adapter";
import { CATEGORIES, CATEGORY_LABELS } from "@/server/scoring/model";
import { getSnapshotContent } from "@/server/snapshot/store";
import { ActionForm } from "../../action-form";
import { saveDecisionAction } from "../../actions";
import { selectClass } from "../../labels";

export const metadata = { title: "Gold-Review – Benchmark-Mapping" };

export default function GoldUnitPage({ params }: PageProps<"/gold/units/[unitId]">) {
  return (
    <div className="space-y-6">
      <Link href="/gold" className="text-sm text-muted-foreground hover:text-foreground">
        ← Gold-Entwurf
      </Link>
      <Suspense fallback={<p className="text-muted-foreground">Lade Review …</p>}>
        <Review params={params} />
      </Suspense>
    </div>
  );
}

async function Review({ params }: Pick<PageProps<"/gold/units/[unitId]">, "params">) {
  const unitId = decodeURIComponent((await params).unitId);
  const db = getDatabase();
  const review = await getGoldUnitReview(db, unitId);
  if (!review) notFound();
  const draft = await getGoldDraft(db);
  const taxonomy = draft ? ((await getSnapshotContent(db, draft.snapshotId))?.industries ?? []) : [];
  const sortedTaxonomy = [...taxonomy].sort(
    (a, b) => a.sectorName.localeCompare(b.sectorName) || a.industryName.localeCompare(b.industryName),
  );
  const { unit, gold, proposals, industries, decisionsDiffer } = review;
  const answered = proposals.filter((proposal) => proposal.answer);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{unit.unitName}</h1>
        <p className="font-mono text-xs text-muted-foreground">{unit.unitId}</p>
        <p className="text-sm text-muted-foreground">
          {unit.committeeName} · {unit.kind} · {unit.chamber}
          {unit.inputBasis === "name_only" && " · name_only"}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Zuständigkeitstext</h2>
        {unit.jurisdictionText ? (
          <p className="max-h-72 overflow-y-auto rounded-lg border p-3 text-sm whitespace-pre-wrap">
            {unit.jurisdictionText}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Kein Zuständigkeitstext (name_only).</p>
        )}
        {unit.parentContextText && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Kontext: {unit.parentCommitteeName} (kein Evidence)
            </summary>
            <p className="mt-2 max-h-72 overflow-y-auto rounded-lg border p-3 whitespace-pre-wrap">
              {unit.parentContextText}
            </p>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Vorschläge ({proposals.length})</h2>
        {proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Vorschlagsläufe für den Entwurf.</p>
        ) : (
          <>
            {decisionsDiffer && (
              <p className="text-sm font-medium text-amber-700" data-testid="decisions-differ">
                Die Vorschläge sind sich bei mapped/no_mapping nicht einig.
              </p>
            )}
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${proposals.length}, minmax(16rem, 1fr))` }}
            >
              {proposals.map((proposal) => (
                <ProposalCard key={proposal.runId} proposal={proposal} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Entscheidung</h2>
        <ActionForm action={saveDecisionAction} className="space-y-4" testId="decision-form">
          <input type="hidden" name="unitId" value={unit.unitId} />
          <div className="flex flex-wrap items-end gap-6 text-sm">
            <label className="flex flex-col gap-1">
              Kategorie
              <select name="category" className={selectClass} defaultValue={gold.category}>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="noMapping" defaultChecked={gold.noMapping} />
              no_mapping
            </label>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Industry</TableHead>
                {proposals.map((proposal) => (
                  <TableHead key={proposal.runId} className="text-center">
                    #{proposal.runId}
                  </TableHead>
                ))}
                <TableHead>Klasse</TableHead>
                <TableHead>web_only</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {industries.map((industry) => (
                <TableRow
                  key={industry.industryId}
                  data-testid="review-industry"
                  data-industry={industry.industryId}
                  data-difference={industry.unanimous ? "false" : "true"}
                  className={industry.unanimous ? undefined : "bg-amber-50 dark:bg-amber-950/30"}
                >
                  <TableCell className="max-w-md">
                    <input type="hidden" name="industry" value={industry.industryId} />
                    <div className="font-mono text-xs">{industry.industryId}</div>
                    <div className="text-xs text-muted-foreground">
                      {industry.industryName
                        ? `${industry.industryName} · ${industry.sectorName} – ${industry.description}`
                        : "nicht in der Taxonomie"}
                    </div>
                  </TableCell>
                  {proposals.map((proposal) => (
                    <TableCell key={proposal.runId} className="text-center">
                      {industry.proposedBy.includes(proposal.runId) ? "✓" : proposal.answer ? "–" : ""}
                    </TableCell>
                  ))}
                  <TableCell>
                    <select
                      name={`class:${industry.industryId}`}
                      aria-label={`Klasse ${industry.industryId}`}
                      className={selectClass}
                      defaultValue={industry.gold?.class ?? ""}
                    >
                      <option value="">nicht im Gold</option>
                      <option value="positiv">positiv</option>
                      <option value="vertretbar">vertretbar</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      name={`webOnly:${industry.industryId}`}
                      aria-label={`web_only ${industry.industryId}`}
                      defaultChecked={industry.gold?.webOnly ?? false}
                    />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  <Input
                    name="newIndustry"
                    list="taxonomy-options"
                    aria-label="Weitere Industry"
                    placeholder="weitere Industry (industry_id)"
                  />
                  <datalist id="taxonomy-options">
                    {sortedTaxonomy.map((industry) => (
                      <option key={industry.industryId} value={industry.industryId}>
                        {industry.industryName} · {industry.sectorName}
                      </option>
                    ))}
                  </datalist>
                </TableCell>
                {proposals.map((proposal) => (
                  <TableCell key={proposal.runId} />
                ))}
                <TableCell>
                  <select name="newClass" aria-label="Klasse der weiteren Industry" className={selectClass}>
                    <option value="positiv">positiv</option>
                    <option value="vertretbar">vertretbar</option>
                  </select>
                </TableCell>
                <TableCell>
                  <input type="checkbox" name="newWebOnly" aria-label="web_only der weiteren Industry" />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {answered.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Hervorgehoben: Industries, die nicht alle {answered.length} Vorschläge nennen.
            </p>
          )}

          <label className="flex flex-col gap-1 text-sm">
            Notiz (Begründung)
            <textarea
              name="note"
              defaultValue={gold.note ?? ""}
              rows={3}
              className="rounded-lg border bg-background p-2 text-sm"
            />
          </label>
          <Button type="submit">Entscheidung speichern</Button>
        </ActionForm>
      </section>

      <section className="space-y-2">
        <details>
          <summary className="cursor-pointer text-lg font-medium">Taxonomie nachschlagen</summary>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead>Sektor</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Beschreibung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTaxonomy.map((industry) => (
                <TableRow key={industry.industryId}>
                  <TableCell className="text-xs">{industry.sectorName}</TableCell>
                  <TableCell>
                    <div>{industry.industryName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{industry.industryId}</div>
                  </TableCell>
                  <TableCell className="text-xs whitespace-normal">{industry.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      </section>
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: GoldProposal }) {
  const { configuration, answer, error } = proposal;
  return (
    <article className="space-y-2 rounded-lg border p-3 text-sm" data-testid="proposal">
      <header>
        <div className="font-medium">
          #{proposal.runId} · {HARNESS_LABELS[configuration.harness]}
        </div>
        <div className="text-xs text-muted-foreground">
          {configuration.model} · {configuration.effort}
        </div>
      </header>
      {!answer ? (
        <p className="text-muted-foreground">
          {error ? `${error.kind}: ${error.message ?? ""}` : `noch keine Antwort (${proposal.status})`}
        </p>
      ) : (
        <>
          <p>
            <Badge variant={answer.decision === "no_mapping" ? "secondary" : "default"}>
              {answer.decision}
            </Badge>
            {answer.broad_scope_exception && <Badge variant="outline">Broad Scope</Badge>}
            {answer.label_uncertain && <Badge variant="destructive">label_uncertain</Badge>}
          </p>
          {answer.no_mapping_reason && <p className="text-xs">{answer.no_mapping_reason}</p>}
          {answer.broad_scope_reason && <p className="text-xs">Broad Scope: {answer.broad_scope_reason}</p>}
          <ul className="space-y-2">
            {answer.assignments.map((assignment) => (
              <li key={assignment.industry_id}>
                <div className="font-mono text-xs">{assignment.industry_id}</div>
                <div className="text-xs italic">„{assignment.evidence_excerpt}“</div>
                <div className="text-xs text-muted-foreground">{assignment.rationale_short}</div>
              </li>
            ))}
          </ul>
          {answer.uncertainty_note && (
            <p className="text-xs">
              <span className="font-medium">Unsicherheit:</span> {answer.uncertainty_note}
            </p>
          )}
          {answer.sources.length > 0 && (
            <div className="text-xs">
              <div className="font-medium">Quellen</div>
              <ul className="list-disc pl-4">
                {answer.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer" className="underline break-all">
                      {source.url}
                    </a>{" "}
                    – {source.belegt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </article>
  );
}
