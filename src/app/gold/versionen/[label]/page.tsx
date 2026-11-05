import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { toScoringGold } from "@/server/gold/model";
import { getGoldDraft, getGoldVersion, getLatestGoldVersion } from "@/server/gold/store";
import { reevaluateAllRuns } from "@/server/scoring/current";
import { CATEGORY_LABELS } from "@/server/scoring/model";
import { formatDateTime } from "../../../laeufe/labels";
import { ActionForm } from "../../action-form";
import { startDraftFromVersionAction } from "../../actions";
import { ReevaluationStatusLine } from "../../reevaluation-status";

export const metadata = { title: "Gold-Version – Benchmark-Mapping" };

export default function GoldVersionPage({ params }: PageProps<"/gold/versionen/[label]">) {
  return (
    <div className="space-y-6">
      <Link href="/gold" className="text-sm text-muted-foreground hover:text-foreground">
        ← Gold
      </Link>
      <Suspense fallback={<p className="text-muted-foreground">Lade Gold-Version …</p>}>
        <GoldVersionDetail params={params} />
      </Suspense>
    </div>
  );
}

async function GoldVersionDetail({ params }: Pick<PageProps<"/gold/versionen/[label]">, "params">) {
  const { label } = await params;
  const db = getDatabase();
  const version = await getGoldVersion(db, label);
  if (!version) notFound();
  const [latest, draft] = await Promise.all([getLatestGoldVersion(db), getGoldDraft(db)]);
  const isLatest = latest?.id === version.id;
  // Die neueste Gold-Version ist die aktuelle: alle abgeschlossenen Benchmark-Läufe sind gegen sie bewertet.
  const reevaluation = isLatest ? await reevaluateAllRuns(db, toScoringGold(version)) : null;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <>
            <span data-testid="gold-version-label">{version.label}</span>
            {isLatest && <span className="ml-2 text-base font-normal text-muted-foreground">(aktuell)</span>}
          </>
        }
        description={
          <>
            Eingefroren {formatDateTime(version.frozenAt)} · {version.units.length} Units · Snapshot{" "}
            <span className="font-mono text-xs">{version.snapshotHash.slice(0, 12)}</span>
            {version.baseLabel && (
              <>
                {" · "}Ausgangspunkt{" "}
                <Link
                  href={`/gold/versionen/${version.baseLabel}`}
                  className="text-primary hover:underline"
                  data-testid="gold-version-base"
                >
                  {version.baseLabel}
                </Link>
              </>
            )}
          </>
        }
      />
      {reevaluation ? (
        <ReevaluationStatusLine status={reevaluation} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Nicht mehr aktuell: die Auswertung nutzt {latest?.label}; Bewertungen gegen {version.label} bleiben
          gespeichert.
        </p>
      )}
      {draft ? (
        <p className="text-sm text-muted-foreground">
          Es gibt bereits einen Gold-Entwurf; erst abschließen oder verwerfen.
        </p>
      ) : (
        <ActionForm action={startDraftFromVersionAction}>
          <input type="hidden" name="label" value={version.label ?? ""} />
          <Button type="submit" variant="outline">
            Als Ausgangspunkt für eine neue Version bearbeiten
          </Button>
        </ActionForm>
      )}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead>Kategorie</TableHead>
              <TableHead>Gold</TableHead>
              <TableHead>Notiz</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {version.units.map((unit) => (
              <TableRow key={unit.unitId} data-testid="gold-version-unit">
                <TableCell className="font-mono text-xs">{unit.unitId}</TableCell>
                <TableCell>{CATEGORY_LABELS[unit.category]}</TableCell>
                <TableCell className="text-xs">
                  {unit.noMapping
                    ? "no_mapping"
                    : unit.industries
                        .map(
                          (industry) =>
                            `${industry.industryId} (${industry.class}${industry.webOnly ? ", web_only" : ""})`,
                        )
                        .join(", ")}
                </TableCell>
                <TableCell className="text-xs whitespace-normal">{unit.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
