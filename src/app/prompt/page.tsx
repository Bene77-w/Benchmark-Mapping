import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDatabase } from "@/server/db/client";
import { buildBenchmarkPrompt, type Mode, type RunKind } from "@/server/prompt/benchmark-prompt";
import { getCurrentSnapshot, getSnapshotContent } from "@/server/snapshot/store";

export const metadata = { title: "Benchmark-Prompt – Benchmark-Mapping" };

const VARIANTS = [
  { value: "benchmark/text_only", label: "Benchmark – nur Zuständigkeitstext" },
  { value: "benchmark/web", label: "Benchmark – mit Websuche" },
  { value: "proposal/web", label: "Vorschlagslauf (Gold-Brief, mit Websuche)" },
] as const;
type Variant = (typeof VARIANTS)[number]["value"];

export default function PromptPage({ searchParams }: PageProps<"/prompt">) {
  return (
    <div>
      <PageHeader
        title="Benchmark-Prompt"
        description="Vorschau des System- und User-Prompts für eine Unit."
      />
      <Suspense fallback={<p className="text-muted-foreground">Lade Prompt …</p>}>
        <PromptPreview searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PromptPreview({ searchParams }: Pick<PageProps<"/prompt">, "searchParams">) {
  const params = await searchParams;
  const db = getDatabase();
  const summary = await getCurrentSnapshot(db);
  const snapshot = summary && (await getSnapshotContent(db, summary.snapshotId));
  if (!snapshot) {
    return (
      <p className="text-muted-foreground">
        Kein Snapshot geladen. <code>pnpm db:prepare</code> ausführen.
      </p>
    );
  }

  const units = snapshot.units.toSorted((a, b) => (a.unitId < b.unitId ? -1 : 1));
  const unitId =
    typeof params.unit === "string" && units.some((unit) => unit.unitId === params.unit)
      ? params.unit
      : units[0].unitId;
  const variant: Variant =
    VARIANTS.find((option) => option.value === params.lauf)?.value ?? VARIANTS[0].value;
  const [runKind, mode] = variant.split("/") as [RunKind, Mode];
  const prompt = await buildBenchmarkPrompt(snapshot, { runKind, mode });
  const unitPrompt = prompt.forUnit(unitId);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" action="/prompt">
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Unit
              <select
                name="unit"
                defaultValue={unitId}
                className="h-9 max-w-xl rounded-lg border bg-background px-2"
              >
                {units.map((unit) => (
                  <option key={unit.unitId} value={unit.unitId}>
                    {unit.unitId} – {unit.unitName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted-foreground">
              Lauf
              <select name="lauf" defaultValue={variant} className="h-9 rounded-lg border bg-background px-2">
                {VARIANTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Anzeigen
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Prompt-Version</dt>
            <dd data-testid="prompt-version">{prompt.version}</dd>
            <dt className="text-muted-foreground">Prompt-Hash (Lauf)</dt>
            <dd data-testid="prompt-hash" className="font-mono text-xs break-all">
              {prompt.promptHash}
            </dd>
            <dt className="text-muted-foreground">Unit-Hash</dt>
            <dd data-testid="unit-prompt-hash" className="font-mono text-xs break-all">
              {unitPrompt.unitPromptHash}
            </dd>
            <dt className="text-muted-foreground">Ausgabeschema</dt>
            <dd>
              {prompt.outputSchemaVersion}{" "}
              <span className="font-mono text-xs break-all text-muted-foreground">
                {prompt.outputSchemaHash}
              </span>
            </dd>
            <dt className="text-muted-foreground">Snapshot</dt>
            <dd>
              {snapshot.version}{" "}
              <span className="font-mono text-xs break-all text-muted-foreground">
                {snapshot.contentHash}
              </span>
            </dd>
          </dl>
        </CardContent>
      </Card>

      <PromptText title="System-Prompt" testId="system-prompt" text={unitPrompt.systemPrompt} />
      <PromptText title="User-Prompt" testId="user-prompt" text={unitPrompt.userPrompt} />
      <Card>
        <CardContent>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm font-semibold">Ausgabeschema (JSON-Schema)</summary>
            <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/40 p-4 text-xs">
              {JSON.stringify(prompt.outputSchema, null, 2)}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

function PromptText({ title, testId, text }: { title: string; testId: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre
          data-testid={testId}
          className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-xs"
        >
          {text}
        </pre>
      </CardContent>
    </Card>
  );
}
