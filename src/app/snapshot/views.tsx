import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Chamber, CleanupKind, Industry, UnitKind } from "@/server/snapshot/model";
import type { UnitView } from "@/server/snapshot/store";

const KIND_LABEL: Record<UnitKind, string> = {
  subcommittee: "Subcommittee",
  committee_parent_core: "Committee-Kern (committee_parent_core)",
  committee_direct: "Committee ohne Subcommittees (committee_direct)",
};

const CHAMBER_LABEL: Record<Chamber, string> = { house: "House", senate: "Senat", joint: "Joint" };

const CLEANUP_LABEL: Record<CleanupKind, string> = {
  kuratorennotiz: "Kuratorennotiz",
  deutscher_text: "Deutscher Text",
  silbentrennung: "Silbentrennung",
  zu_kurzer_text: "Zu kurzer Text",
  artefakt: "Artefakt",
  markdown: "Markdown-Rest",
};

export function UnitList({ units }: { units: UnitView[] }) {
  if (units.length === 0) return <p className="text-muted-foreground">Keine Unit gefunden.</p>;
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">{units.length} Units</p>
      <ul className="space-y-3">
        {units.map((unit) => (
          <li key={unit.unitId} className="rounded-xl border bg-card p-4 shadow-xs" data-testid="unit">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{unit.unitName}</h2>
              <Badge variant="secondary">{KIND_LABEL[unit.kind]}</Badge>
              <Badge variant="outline">{CHAMBER_LABEL[unit.chamber]}</Badge>
              {unit.inputBasis === "name_only" && <Badge>name_only</Badge>}
              {unit.cleanups.length > 0 && (
                <Badge variant="destructive">{unit.cleanups.length} Bereinigung(en)</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Committee: {unit.committeeName}
              {unit.parentCommitteeName && unit.parentCommitteeName !== unit.committeeName
                ? ` · Übergeordnet: ${unit.parentCommitteeName}`
                : ""}
              {" · "}
              <span className="font-mono text-xs">{unit.unitId}</span>
            </p>
            <div className="mt-3 text-sm">
              {unit.jurisdictionText === null ? (
                <p className="italic text-muted-foreground">Kein Zuständigkeitstext</p>
              ) : (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Zuständigkeitstext</summary>
                  <p className="mt-2 whitespace-pre-wrap">{unit.jurisdictionText}</p>
                </details>
              )}
              {unit.parentContextText && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted-foreground">
                    Kontext des übergeordneten Committees (keine Evidence)
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{unit.parentContextText}</p>
                </details>
              )}
              {unit.cleanups.length > 0 && <CleanupList cleanups={unit.cleanups} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CleanupList({ cleanups }: { cleanups: UnitView["cleanups"] }) {
  return (
    <details className="mt-2" open>
      <summary className="cursor-pointer text-muted-foreground">Bereinigungen</summary>
      <ol className="mt-2 space-y-2">
        {cleanups.map((cleanup, index) => (
          // Reihenfolge des Registers ist fest; der Index ist ein stabiler Schlüssel.
          // biome-ignore lint/suspicious/noArrayIndexKey: siehe oben
          <li key={index} className="rounded-md bg-muted/50 p-3">
            <p className="font-medium">
              {CLEANUP_LABEL[cleanup.kind]}{" "}
              <span className="font-normal text-muted-foreground">– {cleanup.reason}</span>
            </p>
            <p className="mt-1">
              <span className="text-muted-foreground">Vorher: </span>
              <del className="decoration-destructive">{cleanup.before}</del>
            </p>
            <p className="mt-1">
              <span className="text-muted-foreground">Nachher: </span>
              {cleanup.after ? <ins className="no-underline">{cleanup.after}</ins> : <em>(entfernt)</em>}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function IndustryTable({ industries }: { industries: Industry[] }) {
  if (industries.length === 0) return <p className="text-muted-foreground">Keine Industry gefunden.</p>;
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">{industries.length} Industries</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Industry</TableHead>
                <TableHead>Sektor</TableHead>
                <TableHead>Beschreibung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {industries.map((industry) => (
                <TableRow key={industry.industryId} data-testid="industry">
                  <TableCell className="align-top">
                    <div className="font-medium">{industry.industryName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{industry.industryId}</div>
                  </TableCell>
                  <TableCell className="align-top">{industry.sectorName}</TableCell>
                  <TableCell className="whitespace-normal align-top text-sm">
                    {industry.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
