# Kosten- und Token-Erfassung für headless Codex-CLI- und OpenCode-Aufrufe

Stand: 2026-10-23. Geprüft mit `codex-cli 0.163.0` und `opencode v2.1.3`. Ergänzt [kosten-claude-code.md](./kosten-claude-code.md).

## Kurzfassung

- **Codex** liefert mit `codex exec --json` **nur Tokens und keine Dollarbeträge**. Das Event `turn.completed.usage` enthält `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens` (neu), `output_tokens` und `reasoning_output_tokens`. `input_tokens` **enthält** die gecachten Tokens, `output_tokens` **enthält** die Reasoning-Tokens.
- Websuchen lassen sich zählen: Jede Suche erscheint als `item.completed` mit `item.type == "web_search"`, inklusive Query.
- Modell und **tatsächlich verwendetes Effort** stehen nur im Rollout (`$CODEX_HOME/sessions/**/rollout-*.jsonl`, Felder `turn_context.effort` und `thread_settings_applied.reasoning_effort`), nicht im `--json`-Stream. Der Rollout enthält auch Tokens pro einzelnem Request (`token_usage_record`) und das Kontingent (`rate_limits`).
- Das **Kontingent in Prozent** taugt nicht als Kostenmaß pro Aufgabe. Es wird in **ganzzahligen Prozent** gemeldet, die Fenster laufen über 5 h/7 Tage bzw. beim Free-Plan über 30 Tage, und andere Nutzung desselben Kontos verfälscht den Wert. **Wichtig:** Die aktuell hinterlegte `auth.json` meldet `plan_type: "free"` und nicht `plus` (siehe 1.3).
- **OpenCode** berechnet `cost` selbst: Tokens × Preis aus **models.dev**. Empirisch geprüft, die Rechnung geht auf die letzte Stelle genau auf. Pro Step (`step_finish`), pro Message und pro Session (`opencode session export`) sowie aggregiert (`opencode stats --json`). Bei ChatGPT-Abo-Modellen setzt OpenCode den Preis auf `[]`, die Kosten sind dann **0**. Dasselbe gilt für Free-Modelle und für eigene Provider ohne `cost`-Angabe.
- **Bug/Risiko in v2.1.3:** Im `--format json`-Stream **fehlt das `step_finish` des letzten Steps** (Race beim Finalisieren). Wer nur die Stream-Events summiert, zählt zu wenig. Verlässlich ist `opencode session export <id>`.
- **Empfehlung (beide Harnesses, auch Claude Code):** Rohe Tokens speichern und die Kosten **selbst mit einer einheitlichen, versionierten Preistabelle** berechnen, die als datierter Snapshot von `https://models.dev/api.json` angelegt wird. Für jeden Harness gibt es eine dokumentierte Normalisierung (siehe 4). Native Felder (OpenCode `cost`, Claude `total_cost_usd`) dienen nur als Plausibilitätsprüfung, Kontingent-% nur als Zusatzinfo.

---

## 1. Codex CLI (ChatGPT-Abo)

### 1.1 Testaufruf (identisch zum bisherigen `run_codex`)

```bash
CODEX_HOME=$T/home codex exec --output-schema schema.json --output-last-message antwort.txt --json \
  --sandbox read-only --skip-git-repo-check --ignore-user-config -c tools.web_search=false \
  --color never -C $T/work -m gpt-5.6-luna -c model_reasoning_effort="low" -  < prompt
```
`$T/home/auth.json` ist ein Symlink auf `~/.codex/auth.json`. Im Test kam bei leerem Home die Warnung `could not create PATH aliases … under temporary dir "/tmp"` (harmlos).

**`--json`-Stream, ohne Websuche (vollständig):**
```json
{"type":"thread.started","thread_id":"…"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\"answer\":\"OK\"}"}}
{"type":"turn.completed","usage":{"input_tokens":13225,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":15,"reasoning_output_tokens":0}}
```

**Mit `-c tools.web_search=true` (gekürzt):**
```json
{"type":"item.started","item":{"id":"item_0","type":"web_search","query":"","action":{"type":"other"}}}
{"type":"item.completed","item":{"id":"item_0","type":"web_search","query":"site:nodejs.org current Node.js LTS version","action":{"type":"search","query":"…"},"results":[{"type":"text_result","domain":"nodejs.org","title":"…","url":"…","snippet":"…"}]}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"{\"answer\":\"v24.22.1\"}"}}
{"type":"turn.completed","usage":{"input_tokens":31011,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":87,"reasoning_output_tokens":18}}
```

Befunde:
- **Kein Dollarbetrag** und keine Modell- oder Effort-Angabe im Stream.
- `total = input + output` (13225+15 = 13240, 31011+87 = 31098). Reasoning ist also in `output_tokens` **enthalten**. Gecachte Tokens sind laut Quellcode in `input_tokens` enthalten: `non_cached_input() = input_tokens - cached_input()` in `codex-rs/protocol/src/protocol.rs`.
- `cache_write_input_tokens` ist ein neues Feld (`#[serde(default)]`) und steht noch nicht in der offiziellen Doku. Das zeigt, dass sich das Schema zwischen CLI-Versionen ändert.
- Websuche: `item.completed` mit `type:"web_search"` zählen, `item.started` nicht mitzählen. Intern lief die Suche über ein Code-Mode-`exec`-Tool (`tools.web__run`, siehe Rollout). Ein Item kann also auch mehrere Queries bündeln (`search_query:[…]`). Die Anzahl der Items ist nur eine Näherung für die Zahl der Suchaufrufe.
- Basis-Overhead ~13k Input-Tokens pro Aufruf. Darin stecken auch Skills aus `/home/bene/.agents/skills` (Skill-Root `r0`), **obwohl `--ignore-user-config` gesetzt ist**. Für faire Vergleiche sollte man das wissen bzw. die Skills ausschließen.

### 1.2 Session-Rollout (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-…-<thread_id>.jsonl`)

Wird ohne `--ephemeral` geschrieben. Relevante Einträge (gekürzt, IDs entfernt):

```json
{"type":"session_meta","payload":{"originator":"codex_exec","cli_version":"0.163.0","source":"exec","model_provider":"openai", …}}
{"type":"turn_context","payload":{"model":"gpt-5.6-luna","effort":"low","summary":"none","collaboration_mode":{"settings":{"model":"gpt-5.6-luna","reasoning_effort":"low"}}, "sandbox_policy":{"type":"read-only"}, …}}
{"type":"event_msg","payload":{"type":"thread_settings_applied","thread_settings":{"model":"gpt-5.6-luna","model_provider_id":"openai","reasoning_effort":"low", …}}}
{"type":"token_usage_record","payload":{"response_id":"resp_…","usage":{"input_tokens":13447,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":67,"reasoning_output_tokens":18,"total_tokens":13514},"turn_token_usage":{…},"thread_token_usage":{…}}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{…},"last_token_usage":{…},"model_context_window":258400},
  "rate_limits":{"limit_id":"codex","primary":{"used_percent":0.0,"window_minutes":43200,"resets_at":…},"secondary":null,
                 "credits":{"has_credits":false,"unlimited":false,"balance":null},"plan_type":"free","rate_limit_reached_type":null}}}
{"type":"event_msg","payload":{"type":"task_complete","duration_ms":2736,"time_to_first_token_ms":2634, …}}
```

- **Effort-Bestätigung: ja.** `turn_context.effort` und `thread_settings_applied.thread_settings.reasoning_effort` zeigen den effektiv angewendeten Wert. Ein Prüfen auf `== angefordert` erkennt stille Fallbacks, etwa bei einem Tippfehler im `-c`-Wert. Das Modell steht ebenfalls dort.
- **Tokens pro Request:** `token_usage_record.usage` bzw. `token_count.info.last_token_usage` gibt es je Sampling-Request. Im Websuche-Lauf gab es zwei Requests mit 13447 und 17564 Input-Tokens. Das ist nötig, wenn Preisstufen abhängig vom Kontext gelten (models.dev: `tiers` ab 272k Kontext bei GPT-5.6/6). Aus der Turn-Summe in `--json` lässt sich die Stufe nicht bestimmen.
- Das Rollout-Format ist intern und nicht als stabile API dokumentiert. Es wurde z. B. um `token_usage_record`, `world_state` und `ordinal` erweitert, siehe `~/.codex/rollout-migrations`.

### 1.3 Rate-Limits/Kontingent als „Abo-Kosten“

- Schema laut `RateLimitWindow` in `protocol.rs`: `used_percent: f64 (0–100)`, `window_minutes`, `resets_at`. Dazu kommen `primary`/`secondary`, `credits`, `plan_type` und `spend_control_reached`.
- Beobachtet in echten Sessions unter `~/.codex/sessions`: Plus-Plan mit `primary` 300 min (5 h) und `secondary` 10080 min (7 Tage). Die Werte waren **immer ganzzahlig**, z. B. 1.0, 3.0, 48.0. Der aktuelle Login meldet dagegen `plan_type:"free"`, `primary.window_minutes = 43200` (30 Tage), `secondary = null`, und nach zwei Aufrufen `used_percent 0.0`.
- Konsequenz: Die Auflösung liegt bei ≥ 1 % eines Wochen- oder Monatsfensters. Eine Mini-Aufgabe ergibt dabei ein Delta von 0. Parallel laufende interaktive Nutzung (TUI, App, andere Benchmarks) verfälscht das Delta, und die Kontingentgewichtung pro Modell ist undokumentiert. Brauchbar ist das höchstens als **Batch-Summe** (vorher/nachher über den gesamten Lauf) und um Limits vor einem Lauf zu prüfen.
- **Zu klären:** Der Abo-Wechsel (`~/.codex/codex_Abo_wechsel`) betrifft offenbar das verknüpfte Konto. Vor Benchmarkläufen prüfen, welcher Plan aktiv ist. Beim Free-Plan ist das Kontingent knapp.

### 1.4 OpenTelemetry

Laut offizieller Doku (learn.chatgpt.com/docs/config-file/config-advanced) ist `[otel]` opt-in. Felder: `exporter = none | otlp-http | otlp-grpc`, `environment`, `log_user_prompt=false`. Die Events heißen u. a. `codex.api_request`, `codex.sse_event` (Token-Counts bei `response.completed`), `codex.tool_result` und `codex.user_prompt`. Hinzu kommt das Histogramm `turn.token_usage` (total/input/cached/output/reasoning). **Kein Dollarbetrag, keine Rate-Limits.** Achtung: Laut Doku wird `otel` nur aus `~/.codex/config.toml` gelesen. Mit `--ignore-user-config` und temporärem `CODEX_HOME` müsste man es per `-c otel.…` setzen. Das wurde nicht getestet. Gegenüber dem Rollout bringt OTel nur einen Mehrwert, wenn ohnehin ein Collector läuft.

### 1.5 Optionen Codex

| | A: `turn.completed.usage` × eigene Preistabelle | B: Rollout auswerten (Requests, Effort, Rate-Limits) × Preistabelle | C: Kontingent-%-Delta | D: OTel-Export |
|---|---|---|---|---|
| Daten | Turn-Summe der Tokens + Websuche-Items | Tokens pro Request, Modell, Effort, Plan, Kontingent | `used_percent` vorher/nachher | Token-Histogramme, Events |
| Genauigkeit (API-Äquivalent) | gut, aber ohne Kontextstufen | sehr gut, Stufen pro Request möglich | schlecht (1-%-Raster, Störungen durch andere Nutzung) | wie B |
| Aufwand | sehr gering (Stream wird schon gelesen) | gering–mittel (Datei unter temp. `CODEX_HOME` parsen) | gering | mittel–hoch (Collector) |
| Risiko bei Versionswechsel | niedrig–mittel (dokumentiertes Event, Felder kommen hinzu) | mittel–hoch (internes Format) | mittel | mittel (Attribute ändern sich) |
| Effort-Nachweis | nein | **ja** | nein | teils |

---

## 2. OpenCode v2.1.3

### 2.1 Headless-Aufruf

```bash
opencode run --format json -m 'provider/model#variant' --title <t> [--agent <a>] [--auto] [--standalone] "<prompt>"
```
- `--format json` erzeugt NDJSON mit den Events `step_start`, `text`, `reasoning`, `tool_use`, `step_finish` und `error`. Quelle: `packages/cli/src/run/noninteractive.ts`.
- Modell: `provider/model`, Effort/Variante über das Suffix `#variant`, z. B. `deepseek/deepseek-flash#high`. Gültige Variantennamen kommen aus dem models.dev-Katalog des Modells (`capabilities.reasoning.effort`). Ein unbekannter Name erzeugt einen Fehler. Die gewählte Variante steht im Export (`model.variant`), womit sie **bestätigt** ist.
- Standardmäßig nutzt `run` den **Hintergrund-Service**. Für einen isolierten Benchmark empfiehlt sich `--standalone`.
- **Strukturierte Ausgabe/JSON-Schema:** In v2.1.3 gibt es **keine** CLI-Option dafür. Das Prompt-Schema (`packages/schema/src/prompt.ts`) hat kein `format`-Feld. Das `format: {type:"json_schema"}` der alten v1-SDK-Doku gibt es im v2-Core nicht mehr. Abhilfe: JSON per Prompt anfordern und selbst mit Zod validieren.
- **Websuche:** Das Tool `websearch` nutzt externe Anbieter (Exa, Firecrawl, Parallel, Tavily, TinyFish). Headless und ohne konfigurierten Anbieter erscheint ein Auswahl-Formular, das automatisch abgebrochen wird: Das Tool meldet `"Web search cancelled"`, **Exit-Code 1**, obwohl die Antwort korrekt war. Das Modell wich dann auf `webfetch` aus. Steuerung über eine Projekt-`opencode.json` im Arbeitsverzeichnis:
  - aus: `"websearch": false` und zusätzlich `"policies":[{"action":"tool.use","resource":"webfetch:*","effect":"deny"}]`
  - an: `"websearch": {"provider": "exa"}` (bzw. `"random"`) mit API-Key per Umgebungsvariable. Die Suche selbst kostet dann beim Suchanbieter, und **OpenCode rechnet das nicht in `cost` ein**.
- Login/Provider auf diesem Rechner (`opencode auth list`): DeepSeek (gespeichert), OpenRouter, eigener Provider `favourite-models` (openai-kompatibel → OpenRouter, Modelle **ohne** `cost`-Angabe) und die kostenlosen `opencode/*-free`-Modelle. Für `openai` und `xai` sind nur Umgebungsvariablen konfiguriert. **Kein ChatGPT-OAuth-Login aktiv.**

### 2.2 Event- und Export-Beispiele (gekürzt)

Lauf 2 (`deepseek/deepseek-flash#high`, mit Tool-Aufrufen):
```json
{"type":"tool_use","part":{"type":"tool","tool":"websearch","state":{"status":"error","input":{"query":"nodejs current LTS"},"error":"Web search cancelled"}}}
{"type":"step_finish","part":{"type":"step-finish","reason":"tool-calls","cost":0.00011646599999999999,"tokens":{"input":143,"output":42,"reasoning":69,"cache":{"read":9472,"write":0}}}}
{"type":"tool_use","part":{"type":"tool","tool":"webfetch","state":{"status":"completed","input":{"url":"https://nodejs.org/dist/index.json"}, …}}}
{"type":"step_finish","part":{"reason":"tool-calls","cost":0.00010245,"tokens":{"input":155,"output":62,"reasoning":22,"cache":{"read":9600,"write":0}}}}
{"type":"step_start", …}
{"type":"text","part":{"type":"text","text":"24.22.1"}}
   ← hier fehlt das step_finish des letzten Steps (cost 0.00347, 22559 Input-Tokens)
```

`opencode session export <id>`:
```json
{"info":{"model":{"id":"deepseek-flash","providerID":"deepseek","variant":"high"},
         "cost":0.0038694300000000005,
         "tokens":{"input":23285,"output":204,"reasoning":187,"cache":{"read":47360,"write":0}},
         "outcome":"succeeded"},
 "messages":[{"type":"user"},
   {"type":"assistant","model":{…,"variant":"high"},"finish":"tool-calls","cost":9.2898e-05,"tokens":{…}},
   …,
   {"type":"assistant","finish":"stop","cost":0.003469434,"tokens":{"input":22559,"output":6,"reasoning":88,"cache":{"read":9728,"write":0}}},
   {"type":"idle","outcome":"succeeded"}]}
```
Beim ersten Mini-Lauf fehlte das einzige `step_finish` ebenfalls. Der Stream enthielt nur `step_start` und `text`. Dazu passt der Quellcode: Sobald `session.wait` aufgelöst ist, gilt `finalizing = true`, und danach werden alle Events außer `session.execution.*` verworfen (`noninteractive.ts`, ca. Zeile 265).

`opencode stats --days 0 --json --cost --models` aggregiert pro Zeitraum, Projekt (`--project .`) und Modell (`tokens`, `cost`, `steps`, Tool-Statistik). Eine Zuordnung pro Aufgabe ist damit nicht möglich. Die lokale Datenbank `~/.local/share/opencode/opencode.db` wurde bewusst nicht gelesen, weil sie durch die Nutzer-Policy gesperrt ist. Export und Stats decken den Bedarf ab.

### 2.3 Woher kommt `cost`?

Quelle: `packages/core/src/session/usage.ts`:
```ts
input: usage.nonCachedInputTokens, output: usage.visibleOutputTokens, reasoning: usage.reasoningTokens,
cost = (input*cost.input + (output+reasoning)*cost.output + cache.read*cost.cache.read + cache.write*cost.cache.write) / 1e6
// Kontextstufe: höchste tier mit (input+cache.read+cache.write) > tier.size
```
- Die Preise stammen aus **models.dev** (`packages/core/src/plugin/models-dev.ts`, Snapshot gebündelt + TTL-Refresh) oder aus der `cost`-Angabe in der Provider-Konfiguration.
- **Nachgerechnet** für Lauf 1 (deepseek-flash: input 0.15, output 0.6, cache_read 0.003 $/M): 9304×0.15 + 2×0.6 + 128×0.003 = 1397.184 µ$, also **exakt** `0.001397184`. Daraus folgt: OpenCode-`input` **ohne** Cache, `output` **ohne** Reasoning. Das ist genau umgekehrt zu Codex.
- **Abo-Provider:** Das ChatGPT-Plugin (`packages/core/src/plugin/provider/chatgpt.ts`) setzt `draft.cost = []`, `calculateCost` liefert dann `Money.USD.zero`. Die Kosten sind also **0**, die Tokens bleiben erhalten. Ebenso 0: `opencode/*-free` (models.dev-Preis 0) und eigene Provider ohne `cost` (hier `favourite-models`).
- OpenRouter: OpenCode nutzt den **models.dev-Listenpreis**, nicht den von OpenRouter tatsächlich abgerechneten Betrag. Laut TODO #35765 ist „billed amount“ noch nicht umgesetzt. Abweichungen sind möglich, wenn OpenRouter je nach Upstream-Anbieter andere Preise berechnet.

### 2.4 Optionen OpenCode

| | A: natives `cost` (Export) | B: Tokens (Export) × eigene Preistabelle | C: `step_finish`-Stream summieren | D: `opencode stats --json` Delta |
|---|---|---|---|---|
| Genauigkeit | = models.dev-Listenpreis zum Laufzeitpunkt. 0 bei Abo, Free und eigenen Providern | wie A, aber mit fixer, eigener Preisversion. Abo-Modelle bekommen den API-Äquivalentpreis | **zu niedrig** (letzter Step fehlt in v2.1.3) | Summe korrekt, aber ohne Zuordnung pro Aufgabe |
| Aufwand | gering (1 Zusatzaufruf `session export`) | gering | sehr gering | gering |
| Risiko bei Versionswechsel | mittel (Preis-Snapshot ändert sich still mit dem models.dev-Refresh) | niedrig–mittel (Export-Schema) | hoch (Bug, Event-Format v1→v2 schon geändert) | mittel |
| Einheitlich mit Codex/Claude | nein | **ja** | nein | nein |

---

## 3. Harness-übergreifend einheitliches Kostenmodell

Ein einheitliches Modell ist **möglich und sinnvoll**. Für alle drei Harnesses gilt: Tokens nach Typ erfassen, eine Preisquelle verwenden, eine Formel anwenden.

- **Preisquelle:** models.dev (`https://models.dev/api.json`, ca. 6 MB, 232 Provider). Es ist die native Quelle von OpenCode und enthält auch die Codex-Modelle. Abgleich mit dem Codex-`models_cache.json`: `gpt-6-luna` (0.1/0.5), `gpt-5.6-luna` (0.2/1.2), `gpt-5.6-terra` (2/12) haben Preise. Für `gpt-6-chat-thinking`, `gpt-reserve` und `codex-auto-review` gibt es **keinen** Eintrag, dort muss man manuell nachtragen oder die Modelle ausschließen. Für Claude-Modelle lassen sich die `anthropic/*`-Einträge nutzen und gegen die offizielle Preisliste prüfen (siehe kosten-claude-code.md).
- **Snapshot statt live:** Pro Benchmark-Lauf eine datierte Kopie der benötigten Einträge versioniert ablegen, z. B. `pricing/models-dev-2026-10-23.json`. Dann sind Ergebnisse reproduzierbar und rückwirkend neu berechenbar.
- **Normalisierung auf ein gemeinsames Schema** `{uncachedInput, cacheRead, cacheWrite, outputVisible, reasoning, webSearches}`:
  - Codex: `uncachedInput = input_tokens − cached_input_tokens`, `cacheRead = cached_input_tokens`, `cacheWrite = cache_write_input_tokens`. Ob `cache_write` in `input_tokens` enthalten ist, ist nicht dokumentiert, im Test war es 0. **Vor dem Produktivbetrieb mit gecachten Läufen prüfen.** `reasoning = reasoning_output_tokens`, `outputVisible = output_tokens − reasoning`.
  - OpenCode: `uncachedInput = tokens.input`, `cacheRead = tokens.cache.read`, `cacheWrite = tokens.cache.write`, `outputVisible = tokens.output`, `reasoning = tokens.reasoning`.
  - Formel wie in OpenCode (reasoning × Output-Preis, Kontextstufe pro Request). Bei Codex ist das nur über den Rollout möglich, sonst näherungsweise über die Turn-Summe.
- **Websuche** steht nicht in models.dev. Als eigener Zuschlag in die Tabelle aufnehmen (`webSearchPerCall`). Bei Codex schätzen, ob über ChatGPT-Abo oder API-Websuchgebühr. Bei OpenCode fallen die Kosten beim Suchanbieter an.
- **Bezeichnung im Plot:** „API-Äquivalentkosten (models.dev-Snapshot vom …)“. Bei Abo-Nutzung sind das keine tatsächlichen Ausgaben, aber nur so sind die Werte zwischen den Harnesses vergleichbar. Die Achse „Tokens“ (z. B. uncachedInput + cacheRead + Output gesamt) parallel anbieten.

Beispiel: Der Codex-Testlauf 1 ergibt mit `gpt-5.6-luna` 13225×0.2 + 15×1.2 = **0.00266 $**. Lauf 2 mit Websuche ergibt 0.00631 $ plus Suchzuschlag.

## 4. Empfehlung

1. **Codex:** `turn.completed.usage` aus dem Stream speichern (A) **und** den Rollout aus dem ohnehin temporären `CODEX_HOME` auslesen (B). Aus dem Rollout kommen Modell und Effort zur Bestätigung, die Tokens pro Request für die Kontextstufen und `rate_limits` als Zusatzinfo. Kein `--ephemeral`. Websuchen über `item.completed`/`web_search` zählen. Wenn der Rollout-Parser bei einer neuen CLI-Version scheitert, auf A zurückfallen und die fehlende Effort-Bestätigung als Warnung markieren. Kontingent-% (C) nur als Lauf-Summe und zur Prüfung des Plans vor dem Start (aktuell `free`!). OTel (D) nicht nötig.
2. **OpenCode:** Nach jedem `opencode run --standalone --format json` die Session-ID aus dem ersten Event lesen, dann `opencode session export <id>` ausführen. `info.tokens`, `info.model.variant` und `info.cost` speichern. Die Kosten mit der eigenen Tabelle neu berechnen (B), das native `cost` (A) nur zum Abgleich nutzen. **Nicht** auf `step_finish`-Summen verlassen (C). Pro Lauf ein eigenes Arbeitsverzeichnis mit `opencode.json` für Websuche an/aus. Exit-Code 1 nach abgebrochener Websuche nicht als Aufgabenfehler werten. Strukturierte Ausgabe per Prompt + Zod.
3. **Einheitlich:** Ein Modul `pricing` mit dem models.dev-Snapshot und harness-spezifischen Normalisierern. Rohdaten immer speichern, damit sich Kosten nach Preisänderungen neu berechnen lassen. Native Kostenfelder dienen nur als Plausibilitätsprüfung (Abweichung > 1 % ⇒ Warnung).

## Quellen

- Lokal: `codex --version`, `codex exec --help`, `opencode --version`, `opencode run|stats|session --help`, 2 Codex-Testaufrufe (`gpt-5.6-luna`, low), 2 OpenCode-Testaufrufe (`deepseek/deepseek-flash`, `#high`). Gesamtkosten < 0,01 $.
- Codex-Doku: https://learn.chatgpt.com/docs/non-interactive-mode (früher developers.openai.com/codex/noninteractive), https://learn.chatgpt.com/docs/config-file/config-advanced (OTel)
- Codex-Quellcode: https://github.com/openai/codex – `codex-rs/exec/src/exec_events.rs` (`Usage`, `WebSearchItem`), `codex-rs/protocol/src/protocol.rs` (`RateLimitSnapshot`, `RateLimitWindow`, `non_cached_input`)
- OpenCode-Quellcode, Tag v2.1.3: https://github.com/anomalyco/opencode – `packages/cli/src/run/noninteractive.ts`, `packages/core/src/session/usage.ts`, `packages/core/src/plugin/models-dev.ts`, `packages/core/src/plugin/provider/chatgpt.ts`, `packages/core/src/tool/plugin/websearch.ts`, `packages/schema/src/prompt.ts`
- OpenCode-Doku (v2.1.3, `services/www/src/docs/content/`): `models.mdx` (Varianten), `websearch.mdx`, `policies.mdx`, `permissions.mdx`, `config.mdx`, `cli/commands.mdx`
- Preise: https://models.dev/api.json (abgerufen am 2026-10-23)
