# TODO

Stand: 2026-11-26. Die Umsetzung von Spec #1 ist fertig und in `main` gemergt. Diese Punkte musst du selbst erledigen.

## Version 1 abschließen

- [ ] Optional: in den Tickets die erfüllten Akzeptanzkriterien abhaken. Ausnahme: die Fixtures für das Ratenlimit in #7, #8 und #9 sind konstruiert und stammen nicht aus echten Aufzeichnungen.

## Vor dem ersten Benchmark

- [ ] `.env.local` mit `CODEX_AUTH_HOME` und `OPENCODE_WEBSEARCH_PROVIDER` anlegen und alles mit `pnpm app` starten (siehe [README](README.md#schnellstart)).
- [ ] Unter `/modelle` die Preise der Modelle prüfen, die du testen willst.
- [ ] Unter `/modelle` Websuchpreise für Codex und OpenCode eintragen. Bisher hat nur Claude Code einen ($0,01 pro Suche). Ohne Preis sind die Kosten von Läufen mit Websuche „unbekannt“.

## Gold-Set erstellen

- [ ] Unter `/gold` die empfohlene 30er-Auswahl übernehmen oder eigene Units wählen und kategorisieren (a–f).
- [ ] Vorschlagsläufe mit zwei bis drei Agents starten.
- [ ] Jede Unit reviewen: Branchen als positiv oder vertretbar markieren, `web_only` und `no_mapping` setzen.
- [ ] Gold-Set als `gold-v1` abschließen.

## Benchmark

- [ ] Erste Benchmark-Läufe anlegen, je Agent zuerst mit kleinem Effort.
- [ ] Ergebnisse unter `/auswertung` prüfen.

## Beobachten

- [ ] Tritt bei einem echten Lauf ein Ratenlimit auf, die Ausgabe als Fixture aufnehmen und die konstruierte ersetzen (Befehle in der [technischen Referenz](docs/technik.md#läufe)).
- [ ] Einmal schlug der Browser-Test zur Gold-Versionsseite mit „network error“ fehl, danach nicht mehr. Tritt das wieder auf, untersuchen.
- [ ] Die Diagramme bleiben vorerst handgeschriebenes SVG ([ADR](docs/ADR.md#diagramme-als-eigenes-svg-statt-react-chart-bibliothek)). Steht die Entscheidung endgültig fest, den Branch `prototyp/diagramme` löschen.
