# TODO

Stand: 2026-10-26. Die Umsetzung von Spec #1 ist fertig. Diese Punkte musst du selbst erledigen.

## Version 1 abschließen

- [ ] [PR #15](https://github.com/Bene77-w/Benchmark-Mapping/pull/15) durchsehen und nach `main` mergen. Dadurch schließen sich die Issues #1–#14 automatisch.
- [ ] Optional: in den Tickets die erfüllten Akzeptanzkriterien abhaken. Ausnahme: die Fixtures für das Ratenlimit in #7, #8 und #9 sind konstruiert und stammen nicht aus echten Aufzeichnungen.
- [ ] Nach dem Merge den lokalen Checkout auf `main` umstellen: `git switch main && git pull`.
- [ ] Nicht mehr benötigte Branches löschen: `ticket/*`, `fix/*`, `worktree-agent-*`.

## Vor dem ersten Benchmark

- [ ] App und Worker starten (siehe [README](README.md#schnellstart)).
- [ ] Unter `/modelle` die Preise der Modelle prüfen, die du testen willst.
- [ ] Unter `/modelle` Websuchpreise für Codex und OpenCode eintragen. Bisher hat nur Claude Code einen ($0,01 pro Suche). Ohne Preis sind die Kosten von Läufen mit Websuche „unbekannt“.
- [ ] Für OpenCode mit Websuche einen Suchanbieter wählen, z. B. `OPENCODE_WEBSEARCH_PROVIDER=exa` beim Start des Workers.

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
- [ ] Die Diagramme bleiben vorerst handgeschriebenes SVG ([ADR 0001](docs/adr/0001-diagramme-als-eigenes-svg.md)). Steht die Entscheidung endgültig fest, den Branch `prototyp/diagramme` löschen.
