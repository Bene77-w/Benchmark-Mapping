import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { GOLD_CATEGORY_LABELS, toScoringGold } from "@/server/gold/model";
import { getGoldDraft, getGoldVersion, getLatestGoldVersion } from "@/server/gold/store";
import { reevaluateAllRuns } from "@/server/scoring/current";
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
      <h1 className="text-2xl font-semibold">
        <span data-testid="gold-version-label">{version.label}</span>
        {isLatest && <span className="ml-2 text-base font-normal text-muted-foreground">(aktuell)</span>}
      </h1>
      <p className="text-sm text-muted-foreground">
        Eingefroren {formatDateTime(version.frozenAt)} · {version.units.length} Units · Snapshot{" "}
        <span className="font-mono text-xs">{version.snapshotHash.slice(0, 12)}</span>
        {version.baseLabel && (
          <>
            {" · "}Ausgangspunkt{" "}
            <Link
              href={`/gold/versionen/${version.baseLabel}`}
              className="underline underline-offset-4"
              data-testid="gold-version-base"
            >
              {version.baseLabel}
            </Link>
          </>
        )}
      </p>
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
          Es gibt bereits einen Gold-Entwurf; erst abschließen oder verwerfen, um diese Version als
          Ausgangspunkt zu übernehmen.
        </p>
      ) : (
        <ActionForm action={startDraftFromVersionAction}>
          <input type="hidden" name="label" value={version.label ?? ""} />
          <Button type="submit" variant="outline">
            Als Ausgangspunkt für eine neue Version bearbeiten
          </Button>
        </ActionForm>
      )}
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
              <TableCell>{GOLD_CATEGORY_LABELS[unit.category]}</TableCell>
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
    </div>
  );
}
