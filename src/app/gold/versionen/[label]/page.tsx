import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { GOLD_CATEGORY_LABELS } from "@/server/gold/model";
import { getGoldVersion } from "@/server/gold/store";
import { formatDateTime } from "../../../laeufe/labels";

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
  const version = await getGoldVersion(getDatabase(), label);
  if (!version) notFound();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold" data-testid="gold-version-label">
        {version.label}
      </h1>
      <p className="text-sm text-muted-foreground">
        Eingefroren {formatDateTime(version.frozenAt)} · {version.units.length} Units · Snapshot{" "}
        <span className="font-mono text-xs">{version.snapshotHash.slice(0, 12)}</span>
      </p>
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
