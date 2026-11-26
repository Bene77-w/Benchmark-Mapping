import { BarChart3, Database, FileText, Play, Star, Tags } from "lucide-react";
import Link from "next/link";

const SECTIONS = [
  { href: "/snapshot", label: "Snapshot", hint: "Units, Texte, Taxonomie", icon: Database },
  { href: "/prompt", label: "Prompt", hint: "Aufgabe an die Agents", icon: FileText },
  { href: "/laeufe", label: "Läufe", hint: "Starten und verfolgen", icon: Play },
  { href: "/auswertung", label: "Auswertung", hint: "Rangliste und Diagramme", icon: BarChart3 },
  { href: "/gold", label: "Gold", hint: "Referenz-Zuordnungen", icon: Star },
  { href: "/modelle", label: "Modelle", hint: "Preise und Kosten", icon: Tags },
] as const;

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Benchmark-Mapping</h1>
        <p className="max-w-xl text-muted-foreground">
          Wie gut ordnen AI-Agents Kongress-Units den Industries einer Taxonomie zu?
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ href, label, hint, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-4 rounded-xl border bg-card p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{label}</span>
              <span className="block text-sm text-muted-foreground">{hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
