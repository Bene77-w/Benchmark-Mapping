import type { ReevaluationStatus } from "@/server/scoring/current";

/** Stand der Neubewertung der abgeschlossenen Benchmark-Läufe gegen eine Gold-Version. */
export function ReevaluationStatusLine({ status }: { status: ReevaluationStatus }) {
  const open = status.runs - status.evaluated;
  return (
    <p className="text-sm" data-testid="reevaluation-status">
      Neubewertung gegen {status.goldVersion}:{" "}
      {status.runs === 0 ? (
        "noch keine abgeschlossenen Benchmark-Läufe."
      ) : (
        <>
          {status.evaluated} von {status.runs} abgeschlossenen Benchmark-Läufen bewertet (ohne Modellaufruf)
          {" · "}
          {status.complete} vollständig
          {status.incomplete > 0 && (
            <span className="text-destructive">
              {" · "}
              {status.incomplete} unvollständig für {status.goldVersion} (aus der Auswertung ausgeblendet; auf
              der Lauf-Seite um die fehlenden Units ergänzbar)
            </span>
          )}
          {open > 0 && ` · ${open} noch nicht bewertet`}
        </>
      )}
    </p>
  );
}
