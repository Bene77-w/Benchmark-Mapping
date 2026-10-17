# Benchmark-Mapping

## Agent skills

### Issue tracker

Planung, Specs und Tickets liegen in GitHub Issues für `Bene77-w/Benchmark-Mapping`. Vor Tracker-Aktionen [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) lesen.

### Domain docs

Ein Projektglossar `GLOSSARY.md` und Architekturentscheidungen unter `docs/adr/`. Vor Exploration die Regeln in [docs/agents/domain.md](docs/agents/domain.md) beachten.

## Arbeitsablauf

Die Skills liegen in `.agents/skills/`; Claude Code findet sie über den Symlink `.claude/skills`. Vor ihrer Verwendung die jeweilige `SKILL.md` lesen. Das Testportfolio steht in [.agents/skills/TESTPORTFOLIO.md](.agents/skills/TESTPORTFOLIO.md).

- Vor der ersten Implementierungsänderung den Ankerpunkt nach dem globalen `agent-review` festhalten und im Ticket oder Auftrag mitgeben; User-Vorgaben haben Vorrang.
- Große, unklare Vorhaben nach ausdrücklichem Auftrag mit `wayfinder` planen; dieser nutzt `grilling` und `domain-modeling`.
- Offene Verhaltens- oder UI-Fragen mit `prototype`, Architektur- und Schnittstellenfragen mit `codebase-design` unterstützen.
- Vor einer größeren Umsetzung die Entscheidungen mit `to-spec` zusammenführen und mit `to-tickets` in überprüfbare Aufgaben samt Abhängigkeiten aufteilen.
- Nach Freigabe der Planung die gesamte Spec mit `implement-spec` umsetzen; vereinbarte Testbereiche mit `tdd` prüfen und den Abschlussreview mit dem globalen `agent-review` durchführen.
- Einzelne freigegebene Aufgaben anhand der Spec und Akzeptanzkriterien implementieren, relevante Projektprüfungen ausführen und mit dem globalen `agent-review` prüfen; bestätigte Befunde beheben.
- Schwierige Fehler mit `diagnosing-bugs` untersuchen. `retro` nach einem Durchlauf auf ausdrücklichen Auftrag verwenden.
