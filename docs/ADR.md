# Architekturentscheidungen

## Diagramme als eigenes SVG statt React-Chart-Bibliothek

Die Diagramme der Auswertung (Scatter-Plot, Score je Kategorie, Verlauf) sind handgeschriebenes SVG in React-Komponenten unter `src/app/auswertung/`, keine React-Chart-Bibliothek. Das weicht bewusst von den Implementation Decisions der Spec (Issue #1: „Diagramme mit einer React-Chart-Bibliothek“) ab. Gründe: keine zusätzliche Abhängigkeit (Recharts bringt 36 Pakete mit); die Effizienzgrenze als Treppe und der eigene Bereich für Läufe mit unbekanntem x-Wert passen ohne Umwege; die Punkte sind per Tastatur als Links erreichbar.

Grundlage war ein Vergleichsprototyp beider Varianten (Branch `prototyp/diagramme`, Commit 8f2b415). Entscheidung des Users: [Issue #1, Kommentar](https://github.com/Bene77-w/Benchmark-Mapping/issues/1#issuecomment-6399972495).
