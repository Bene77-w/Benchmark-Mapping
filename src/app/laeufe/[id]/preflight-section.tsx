import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PreflightResult, PreflightStatus } from "@/server/harness/preflight";
import { formatDateTime } from "../labels";

const STATUS_LABELS: Record<PreflightStatus, string> = {
  ok: "ok",
  warning: "Warnung",
  failed: "fehlgeschlagen",
  skipped: "entfällt",
};

const STATUS_CLASSES: Record<PreflightStatus, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
};

/** Ergebnis des Preflights vor der Ausführung (siehe src/server/harness/preflight.ts). */
export function PreflightSection({ preflight }: { preflight: PreflightResult | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preflight</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {preflight ? (
          <>
            <p className="text-sm">
              <span
                data-testid="preflight-status"
                className={cn("font-medium", preflight.ok ? STATUS_CLASSES.ok : STATUS_CLASSES.failed)}
              >
                {preflight.ok ? "bestanden" : "fehlgeschlagen – Lauf blockiert"}
              </span>{" "}
              <span className="text-muted-foreground">
                am {formatDateTime(new Date(preflight.checkedAt))}
                {preflight.cliVersion && ` · CLI ${preflight.cliVersion}`}
              </span>
            </p>
            <ul className="space-y-1 text-sm">
              {preflight.checks.map((check) => (
                <li key={check.id} data-testid="preflight-check">
                  <span className={STATUS_CLASSES[check.status]}>{STATUS_LABELS[check.status]}</span> ·{" "}
                  <span className="font-medium">{check.label}</span>:{" "}
                  <span className="text-muted-foreground">{check.message}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="preflight-status">
            noch nicht ausgeführt
          </p>
        )}
      </CardContent>
    </Card>
  );
}
