# Skill-Testportfolio

Dieses Portfolio gilt für die lokale Testumgebung des Projekts AI-Benchmark Mapping. Die ausgewählten Skills werden beim Bau des Benchmarks erprobt. Eine Übernahme ins globale Setup erfolgt erst nach Auswertung und ausdrücklicher Auswahl; bestehende globale Gruppen werden hierdurch nicht verändert.

## Bestätigte Auswahl: 14 Skills

| Bereich | Skills |
| --- | --- |
| Planung | [wayfinder](wayfinder/SKILL.md), [grilling](grilling/SKILL.md), [domain-modeling](domain-modeling/SKILL.md) |
| Übergabe zur Umsetzung | [to-spec](to-spec/SKILL.md), [to-tickets](to-tickets/SKILL.md) |
| Implementierung | [implement-spec](implement-spec/SKILL.md), [tdd](tdd/SKILL.md) |
| Review und Auswertung | [code-review](code-review/SKILL.md), [retro](retro/SKILL.md) |
| Gezielte Unterstützung | [prototype](prototype/SKILL.md), [codebase-design](codebase-design/SKILL.md), [diagnosing-bugs](diagnosing-bugs/SKILL.md) |
| Orientierung und Einrichtung | [ask-matt](ask-matt/SKILL.md), [setup-matt-pocock-skills](setup-matt-pocock-skills/SKILL.md) |

## Benötigte Hilfsskills

- [research](research/SKILL.md): Wayfinder verwendet ihn zur Bearbeitung von Recherche-Tickets.
- [writing-for-agents](writing-for-agents/SKILL.md): Retro verwendet ihn als Referenz für Verbesserungen an Agent-Dokumenten.

Diese beiden Skills unterstützen die bestätigte Auswahl und sind keine zusätzlichen Pflichtschritte. Insgesamt sind 16 Skill-Verzeichnisse vorhanden. Der einfache `implement`-Skill bleibt ausgeschlossen; seine Ablaufregeln sollen in der Projekt-`AGENTS.md` festgehalten werden.

## Geplanter Ablauf

Grobe Idee → Wayfinder → bei Bedarf Prototype und Codebase Design → Spec → Tickets → Implementierung → Code Review → Retro.

Die Auswahl ist keine Pflichtpipeline: Jeder Skill wird bei einer passenden Aufgabe eingesetzt. Diagnosing Bugs unterstützt bei schwierigen Fehlern.

## Tracker

Der gewählte Tracker ist [GitHub Issues für Bene77-w/Benchmark-Mapping](https://github.com/Bene77-w/Benchmark-Mapping/issues). Das Projekt ist über den SSH-Remote `origin` mit diesem Repository verbunden. Die projektspezifische Tracker-Konfiguration steht in `docs/agents/issue-tracker.md`; die lokale `AGENTS.md` beschreibt den Arbeitsablauf.

## Auswertung

Für jeden Einsatz halten wir Aufgabe, Ergebnis, zusätzlichen Aufwand, nötige Eingriffe und konkrete Probleme mit den Skill-Anweisungen fest. Danach entscheiden wir, ob der Skill unverändert, angepasst oder gar nicht ins globale Setup übernommen wird.

## Herkunft

Die ergänzten Dateien stammen unverändert aus `mattpocock/skills`, Commit `b0618bc436ad893b3c5e84e55fba86586d34a404`, aus dem bereits heruntergeladenen Importbestand.
