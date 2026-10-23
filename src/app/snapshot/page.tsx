import Link from "next/link";
import { Suspense } from "react";
import { Input } from "@/components/ui/input";
import { getDatabase } from "@/server/db/client";
import { getCurrentSnapshot, searchIndustries, searchUnits } from "@/server/snapshot/store";
import { IndustryTable, UnitList } from "./views";

export const metadata = { title: "Snapshot – Benchmark-Mapping" };

type View = "units" | "taxonomie";

export default function SnapshotPage({ searchParams }: PageProps<"/snapshot">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Snapshot</h1>
      <Suspense fallback={<p className="text-muted-foreground">Lade Snapshot …</p>}>
        <SnapshotContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SnapshotContent({ searchParams }: Pick<PageProps<"/snapshot">, "searchParams">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const view: View = params.ansicht === "taxonomie" ? "taxonomie" : "units";
  const db = getDatabase();
  const summary = await getCurrentSnapshot(db);
  if (!summary) {
    return (
      <p className="text-muted-foreground">
        Kein Snapshot geladen. <code>pnpm db:prepare</code> ausführen.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Version</dt>
        <dd>{summary.version}</dd>
        <dt className="text-muted-foreground">Content-Hash</dt>
        <dd className="font-mono text-xs break-all">{summary.contentHash}</dd>
        <dt className="text-muted-foreground">Inhalt</dt>
        <dd>
          {summary.unitCount} Units (davon {summary.nameOnlyCount} name_only), {summary.industryCount}{" "}
          Industries, {summary.cleanupCount} Bereinigungen
        </dd>
      </dl>

      <nav className="flex gap-4 border-b text-sm">
        <ViewLink view="units" current={view} query={query}>
          Units
        </ViewLink>
        <ViewLink view="taxonomie" current={view} query={query}>
          Taxonomie
        </ViewLink>
      </nav>

      <form className="flex max-w-xl gap-2" action="/snapshot">
        <input type="hidden" name="ansicht" value={view} />
        <Input
          name="q"
          type="search"
          defaultValue={query}
          aria-label="Suche"
          placeholder={
            view === "units" ? "Units suchen (Name, Committee, Zuständigkeitstext)" : "Industries suchen"
          }
        />
        <button type="submit" className="rounded-lg border px-3 text-sm hover:bg-muted">
          Suchen
        </button>
      </form>

      {view === "units" ? (
        <UnitList units={await searchUnits(db, { query })} />
      ) : (
        <IndustryTable industries={await searchIndustries(db, { query })} />
      )}
    </div>
  );
}

function ViewLink({
  view,
  current,
  query,
  children,
}: {
  view: View;
  current: View;
  query: string;
  children: React.ReactNode;
}) {
  const active = view === current;
  const href = { pathname: "/snapshot", query: { ansicht: view, ...(query ? { q: query } : {}) } };
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "-mb-px border-b-2 border-foreground pb-2 font-medium"
          : "pb-2 text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}
