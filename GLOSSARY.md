# Benchmark-Mapping

Benchmark, der AI-Agents daran misst, wie gut sie Einheiten des US-Kongresses anhand ihrer Zuständigkeit den Industries einer festen Taxonomie zuordnen.

## Aufgabe

**Unit**:
Eine Einheit des Kongresses, die einzeln gemappt wird: ein Subcommittee, ein Committee ohne Unterausschüsse (`committee_direct`) oder der nicht delegierte Kern eines Committees (`committee_parent_core`).
_Avoid_: Ausschuss (mehrdeutig), Committee (als Oberbegriff)

**Zuständigkeitstext**:
Der Wortlaut der Jurisdiktion einer Unit aus den Geschäftsordnungen von House und Senat; einzige zulässige Evidence neben dem Namen der Unit.
_Avoid_: Jurisdiction-Text, Beschreibung

**name_only**:
Eine Unit ohne Zuständigkeitstext, die nur über ihren Namen belegt werden kann.

**Industry**:
Ein Eintrag der Taxonomie mit `industry_id`, Name, Sektor und Beschreibung; das Zuordnungsziel.
_Avoid_: Branche, Sektor (Sektor ist die Gruppe darüber)

**Taxonomie**:
Die eingefrorene Liste der 145 yfinance-Industries in 11 Sektoren.

**Zuordnung**:
Die Aussage eines Modells, dass eine Industry zu einer Unit gehört, mit wörtlichem `evidence_excerpt` und `rationale_short`.
_Avoid_: Assignment, Match, Mapping (für die einzelne Zeile)

**no_mapping**:
Die Entscheidung, dass keine Industry die Zuordnungsregel erfüllt; ein reguläres Ergebnis.

## Gold

**Gold-Set**:
Die höchstens 30 ausgewählten Units samt abgenommener Referenzantwort, gegen die jeder Lauf bewertet wird.
_Avoid_: Testset, Ground Truth

**Gold-Version**:
Ein eingefrorener, nummerierter Stand des Gold-Sets (`gold-v1`, …); jede Änderung erzeugt eine neue Gold-Version.

**positiv**:
Gold-Klasse einer Industry, die ein Modell nennen muss.
_Avoid_: required, Pflicht

**vertretbar**:
Gold-Klasse einer Industry, die genannt werden darf, ohne bestraft zu werden; höchstens 2 pro Unit.
_Avoid_: acceptable, optional

**web_only**:
Merkmal einer Gold-Industry, die sich nur über Recherche belegen lässt; im Modus ohne Web zählt sie als vertretbar.

**Kategorie**:
Die Art der Schwierigkeit, für die eine Unit im Gold-Set steht (a breit, b eng, c no_mapping, d Committee-Kern/direkt, e name_only, f schwierige Zuordnung).

**Vorschlagslauf**:
Ein Lauf mit Gold-Brief, dessen Antworten nur als Vorschlag in die Gold-Review gehen und nie in die Rangliste.

**Gold-Review**:
Die Abnahme der Vorschläge durch den Menschen, aus der eine Gold-Version entsteht.

## Läufe

**Konfiguration**:
Die Kombination aus Harness, Modell, Effort und Modus, deren Ergebnis verglichen wird.

**Harness**:
Die Agent-CLI, über die ein Modell aufgerufen wird: Claude Code, Codex oder OpenCode.
_Avoid_: Engine, Provider, Agent (für die CLI)

**Modus**:
Ob ein Lauf nur mit dem Zuständigkeitstext oder zusätzlich mit Websuche arbeitet.

**Lauf**:
Die einmalige Ausführung einer Konfiguration über alle Units einer Gold-Version.
_Avoid_: Run (in Texten), Durchgang

**Benchmark-Prompt**:
Der versionierte Modellvertrag samt Brief, den jedes Modell eines Laufs unverändert erhält.

**Snapshot**:
Die eingefrorene, gehashte Kopie von Units, bereinigten Zuständigkeitstexten und Taxonomie.

## Bewertung

**Score**:
Mittelwert der Unit-Scores eines Laufs gegen eine Gold-Version (F1 aus Recall auf positiv und Präzision auf positiv ∪ vertretbar; no_mapping-Units 1 oder 0).

**Format-Fehler**:
Eine Antwort, die auch nach dem Wiederholversuch nicht dem Ausgabeschema entspricht; Unit-Score 0.

**Regelverstoß**:
Eine schemakonforme Antwort, die eine Regel des Benchmark-Prompts bricht, etwa ein nicht wörtliches Zitat oder zu viele Zuordnungen; wird gezählt, nicht wiederholt.

**Geschätzte Kosten**:
Tokens eines Laufs × Preis aus der Preistabelle zum API-Listenpreis, unabhängig davon, ob über Abo oder API abgerechnet wurde.
