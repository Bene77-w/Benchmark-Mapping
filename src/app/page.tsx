import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Benchmark-Mapping</h1>
      <p className="max-w-2xl text-muted-foreground">
        Lokaler Benchmark, der AI-Agents daran misst, wie gut sie Units des US-Kongresses anhand ihres
        Zuständigkeitstexts den Industries einer festen Taxonomie zuordnen.
      </p>
      <p>
        <Link href="/snapshot" className="underline underline-offset-4">
          Snapshot ansehen
        </Link>{" "}
        – Units, Zuständigkeitstexte, Bereinigungen und Taxonomie.
      </p>
      <p>
        <Link href="/laeufe" className="underline underline-offset-4">
          Läufe
        </Link>{" "}
        – Konfiguration zusammenstellen, Lauf starten, Fortschritt und Ergebnisse ansehen.
      </p>
    </div>
  );
}
