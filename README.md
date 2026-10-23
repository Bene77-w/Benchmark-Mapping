# Benchmark-Mapping

Lokaler Benchmark, der AI-Agents (Claude Code, Codex, OpenCode) headless an einer Mapping-Aufgabe misst: Einheiten des US-Kongresses werden anhand ihres Zuständigkeitstexts den Industries einer festen Branchentaxonomie zugeordnet. Bewertet wird gegen ein von Hand abgenommenes Gold-Set; eine GUI zeigt Score, Kosten und Verlauf aller Läufe.

Die Aufgabe stammt aus dem Committee Matcher des Congress Trackers (submapper). Planung, Spec und Tickets stehen in den [GitHub Issues](https://github.com/Bene77-w/Benchmark-Mapping/issues); der Arbeitsablauf in [AGENTS.md](AGENTS.md).

Vorarbeiten: Kandidaten für das Gold-Set in [docs/goldset/kandidaten.md](docs/goldset/kandidaten.md), Recherche zur Kostenerfassung unter [docs/research/](docs/research/).

## Start

Voraussetzungen: Node 24, pnpm 11, Docker mit Compose v2.

```sh
pnpm install
docker compose up -d   # PostgreSQL
pnpm dev               # Migrationen + Snapshot laden, dann App auf http://localhost:3000
```

`pnpm dev` ruft vorher `pnpm db:prepare` auf: Es wendet die Migrationen an und lädt den eingecheckten Snapshot, falls er noch nicht in der Datenbank steht. Die Snapshot-Seite liegt unter `/snapshot`.

Ports sind per Umgebungsvariable wählbar, damit mehrere Worktrees nebeneinander laufen können; beide Befehle müssen dieselben Werte sehen:

```sh
export DB_PORT=55432 APP_PORT=3101
docker compose up -d && pnpm dev
```

`DB_PORT` (Standard 5432) gilt für den Container und die Verbindung der App, `APP_PORT` (Standard 3000) für Next.js. `DATABASE_URL` überschreibt die Verbindung vollständig. Compose trennt Container und Volumes je Verzeichnisname; `docker compose down` stoppt die Datenbank, `docker compose down -v` löscht zusätzlich ihre Daten.

## Snapshot und Import

Die Laufzeit liest nur `data/snapshot/snapshot.json`, nie den Congress Tracker. Der Snapshot enthält alle 225 Units (Typ, Kammer, Committee, Name, übergeordnetes Committee, Parent-Kontext, Zuständigkeitstext oder name_only), die 145 Industries der Taxonomie und das Bereinigungsprotokoll; er trägt `version` und `contentHash` (SHA-256 über den kanonischen Inhalt).

Der Import ist ein einmaliger, nur lesender Schritt:

```sh
pnpm snapshot:import [Pfad zum Congress Tracker]   # Standard: CONGRESS_TRACKER_ROOT oder ~/Nextcloud/Projekte/bmb_trdprg/congress_tracker
```

Er liest `data/committee_matcher_inputs/` (geprüft gegen die Hashes im Corpusmanifest) und `data/committee_matcher_v2/taxonomy/approved_baseline.json` (geprüft gegen `taxonomy_content_hash`), wendet das Bereinigungsregister `data/snapshot/cleanup-register.json` an und schreibt den Snapshot neu. Gleiche Quelle und gleiches Register ergeben denselben Content-Hash. Jede Regel des Registers nennt Unit, Art, vorher/nachher und Begründung; eine Regel, deren Textstelle nicht genau einmal vorkommt, bricht den Import ab. Ersetzte deutsche Texte stehen dort im Originalwortlaut der Quelle (Senate Rule XXV, House Rule X, 15 U.S.C. § 1024(b)). Markdown-Reste der Extraktion (Überschriftszeichen `###`, Zitatmarker `>`, Listenpunkte `-`) sind als Art `markdown` entfernt, damit zeilenübergreifende Zitate wörtlich bleiben.

## Prüfungen

```sh
pnpm check       # Biome, Typecheck, Vitest
pnpm test:e2e    # Playwright gegen den Dev-Server; Datenbank muss laufen
```

Vitest-Tests mit Datenbank laufen gegen eine In-Memory-PGlite (`src/server/db/test-database.ts`) und brauchen kein Docker.
