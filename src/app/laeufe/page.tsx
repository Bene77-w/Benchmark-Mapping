import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDatabase } from "@/server/db/client";
import { getActiveGold } from "@/server/gold/active";
import { HARNESS_LABELS } from "@/server/harness/adapter";
import { AVAILABLE_HARNESSES } from "@/server/harness/registry";
import {
  DEFAULT_PARALLELISM,
  DEFAULT_TIMEOUT_MS,
  MAX_PARALLELISM,
  MIN_PARALLELISM,
} from "@/server/runs/model";
import { listConfigurations, listRuns } from "@/server/runs/store";
import { listCurrentEvaluations } from "@/server/scoring/current";
import { ReevaluationStatusLine } from "../gold/reevaluation-status";
import { restartConfiguration } from "./actions";
import { configurationLabel, formatDateTime, progressLabel, RUN_STATUS_LABELS } from "./labels";
import { NewRunForm } from "./new-run-form";

export const metadata = { title: "Läufe – Benchmark-Mapping" };

export default function RunsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Läufe</h1>
      <Suspense fallback={<p className="text-muted-foreground">Lade Läufe …</p>}>
        <RunsContent />
      </Suspense>
    </div>
  );
}

async function RunsContent() {
  await connection();
  const db = getDatabase();
  const [gold, configurations, runs] = await Promise.all([
    getActiveGold(db),
    listConfigurations(db),
    listRuns(db),
  ]);
  const current = gold ? await listCurrentEvaluations(db, gold) : null;
  const incomplete = new Map(
    (current?.incomplete ?? []).map((entry) => [entry.run.id, entry.missingUnitIds]),
  );

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Neuer Lauf</h2>
        <p className="text-sm text-muted-foreground">
          {gold ? (
            <>
              Gold: <span data-testid="gold-version">{gold.version}</span> ({gold.units.length} Units).
            </>
          ) : (
            <>Noch keine Gold-Version – Läufe brauchen eine abgeschlossene Gold-Review unter „Gold“.</>
          )}{" "}
          Läufe führt der Worker aus (<code>pnpm worker</code>), unabhängig von dieser Seite.
        </p>
        {current && (
          <ReevaluationStatusLine
            status={{
              goldVersion: current.goldVersion,
              runs: current.runs.length + current.incomplete.length,
              evaluated: current.runs.length + current.incomplete.length,
              complete: current.runs.length,
              incomplete: current.incomplete.length,
            }}
          />
        )}
        <NewRunForm
          harnesses={AVAILABLE_HARNESSES.map((harness) => ({
            value: harness,
            label: HARNESS_LABELS[harness],
          }))}
          defaults={{
            parallelism: DEFAULT_PARALLELISM,
            timeoutMinutes: DEFAULT_TIMEOUT_MS / 60_000,
            minParallelism: MIN_PARALLELISM,
            maxParallelism: MAX_PARALLELISM,
          }}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Gespeicherte Konfigurationen</h2>
        {configurations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Konfiguration</TableHead>
                <TableHead>Läufe</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {configurations.map((configuration) => (
                <TableRow key={configuration.id} data-testid="configuration-row">
                  <TableCell>{configurationLabel(configuration)}</TableCell>
                  <TableCell>{configuration.runCount}</TableCell>
                  <TableCell className="text-right">
                    <form action={restartConfiguration}>
                      <input type="hidden" name="configurationId" value={configuration.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Erneut starten
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Alle Läufe</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lauf</TableHead>
                <TableHead>Konfiguration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Units fertig</TableHead>
                <TableHead>Angelegt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link href={`/laeufe/${run.id}`} className="underline underline-offset-4">
                      #{run.id}
                    </Link>
                  </TableCell>
                  <TableCell>{configurationLabel(run.configuration)}</TableCell>
                  <TableCell>
                    {RUN_STATUS_LABELS[run.status]}
                    {incomplete.has(run.id) && (
                      <span className="ml-2 text-xs text-destructive" data-testid="run-list-incomplete">
                        unvollständig für {current?.goldVersion} ({incomplete.get(run.id)?.length} Units
                        fehlen)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{progressLabel(run.progress)}</TableCell>
                  <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
