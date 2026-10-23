# Kosten- und Token-Erfassung für headless Claude-Code-Aufrufe bei Abo-Nutzung

Stand: 2026-10-23 · Claude Code CLI **2.1.309** · Login per Abo (`apiKeySource: "none"`)

## Kurzfassung

- `--output-format json` liefert am Ende ein `result`-Objekt mit `total_cost_usd`, `usage`, `modelUsage` (pro Modell), `num_turns`, `duration_ms` und `duration_api_ms`. **`total_cost_usd` ist auch bei Abo-Nutzung gesetzt.** Es ist eine **clientseitig berechnete Schätzung zum API-Listenpreis**, also kein Betrag, der dem Abo belastet wird.
- Empirisch geprüft: `modelUsage.<modell>.costUSD` lässt sich **auf den Cent-Bruchteil genau** aus den Token-Feldern von `modelUsage` und der offiziellen Preistabelle nachrechnen. Die Websuche ist mit $0,01 pro Suche bereits enthalten.
- **`modelUsage` und `total_cost_usd` decken alles ab**, also auch Hilfsaufrufe wie die interne Websuche und Hilfsmodelle sowie Subagents. **`usage` auf oberster Ebene zählt nur die Hauptschleife** und unterschätzt deutlich: im Test mit Websuche 4 statt 15.428 Input-Tokens und 0 statt 1 Websuche.
- Thinking-Tokens sind **in den Output-Tokens enthalten**: `thinkingTokens` bzw. `output_tokens_details.thinking_tokens` ist eine Teilmenge davon.
- **Empfehlung:** Option B+A. Die Rohdaten aus `modelUsage` speichern (Tokens je Modell und Typ, `webSearchRequests`) und die Kosten mit einer eigenen, versionierten Preistabelle berechnen. `total_cost_usd` und `costUSD` zusätzlich speichern und als Plausibilitätsprüfung verwenden.

## 1. Empirischer Befund

### 1.1 Installierte CLI

- `claude --version` → `2.1.309 (Claude Code)`
- Relevante Flags laut `claude --help`: `--output-format text|json|stream-json`, `--json-schema`, `--max-budget-usd`, `--include-partial-messages` (nur stream-json), `--verbose`, `--safe-mode`, `--effort`.
- **Achtung:** Ist in `~/.claude/settings.json` `"verbose": true` gesetzt (auf diesem Rechner der Fall), gibt `--output-format json` ein **Array aller Events** aus (`system/init`, `rate_limit_event`, `assistant`, `user`, `result`) statt eines einzelnen Objekts. Der Parser sollte deshalb beide Formen akzeptieren und das Element mit `type == "result"` auswählen. Mit `--safe-mode` war die Einstellung trotzdem aktiv.

### 1.2 Testaufrufe

Beide Aufrufe liefen mit `--model haiku --safe-mode --no-session-persistence --strict-mcp-config --output-format json` in `/tmp`.

**Test 1:** `"Antworte nur mit: ok"`, ohne Tools (`--tools ""`). Gekürzter `result`-Block, ohne IDs:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "ok",
  "num_turns": 1,
  "duration_ms": 1172,
  "duration_api_ms": 1772,
  "ttft_ms": 1153,
  "total_cost_usd": 0.0006220900000000001,
  "usage": {
    "input_tokens": 2,
    "cache_creation_input_tokens": 2441,
    "cache_read_input_tokens": 649,
    "output_tokens": 4,
    "output_tokens_details": { "thinking_tokens": 0 },
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
    "cache_creation": { "ephemeral_1h_input_tokens": 2441, "ephemeral_5m_input_tokens": 0 },
    "service_tier": "standard",
    "inference_geo": "global",
    "iterations": [ { "input_tokens": 2, "output_tokens": 4, "cache_read_input_tokens": 649, "cache_creation_input_tokens": 2441, "type": "message" } ],
    "speed": "standard"
  },
  "modelUsage": {
    "claude-haiku-5-5": {
      "inputTokens": 1159,
      "outputTokens": 23,
      "cacheReadInputTokens": 649,
      "cacheCreationInputTokens": 2441,
      "webSearchRequests": 0,
      "costUSD": 0.0006220900000000001,
      "thinkingTokens": 0,
      "contextWindow": 1000000,
      "maxOutputTokens": 128000,
      "canonicalModel": "claude-haiku-5-5",
      "provider": "firstParty",
      "costBasis": "list"
    }
  },
  "subagent_stats": { "spawned": 0, "completed": 0, "failed": 0, "by_type": {} },
  "permission_denials": [],
  "terminal_reason": "completed"
}
```

Beobachtung: `modelUsage.inputTokens` (1159) und `outputTokens` (23) sind deutlich größer als die entsprechenden Werte in `usage` (2 bzw. 4). Selbst ein einfacher Aufruf ohne Tools löst also einen zusätzlichen Hilfsaufruf aus, der nur in `modelUsage` und `total_cost_usd` erfasst wird. Laut OTel-Doku fallen solche Aufrufe unter `query_source = "auxiliary"`.

**Test 2:** Kurze Websuche mit `--tools "WebSearch,WebFetch"`. Auszug aus `result`:

```json
{
  "total_cost_usd": 0.01343509,
  "num_turns": 2,
  "duration_ms": 16437,
  "duration_api_ms": 17446,
  "usage": {
    "input_tokens": 4, "cache_creation_input_tokens": 3752, "cache_read_input_tokens": 6289,
    "output_tokens": 568, "output_tokens_details": { "thinking_tokens": 456 },
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 }
  },
  "modelUsage": {
    "claude-haiku-5-5": {
      "inputTokens": 15428, "outputTokens": 2158,
      "cacheReadInputTokens": 6289, "cacheCreationInputTokens": 3752,
      "webSearchRequests": 1, "thinkingTokens": 1554,
      "costUSD": 0.01343509, "costBasis": "list"
    }
  }
}
```

Weitere Beobachtungen aus dem Event-Stream:

- Die einzelnen `assistant`-Events enthielten `output_tokens: 3` bzw. `24`. Das sind laut Doku **Platzhalter**, nämlich der Stand bei `message_start`. Gültige Output-Tokens stehen nur im `result`.
- `usage.server_tool_use.web_search_requests` bleibt `0`, obwohl eine Suche stattfand. Das WebSearch-Tool von Claude Code führt die Suche in einem eigenen API-Aufruf aus, und nur `modelUsage.webSearchRequests` zählt sie mit.
- Das `rate_limit_event` zeigt die Abo-Auslastung: `five_hour.utilization` stieg von 0,49 auf 0,50, `seven_day` liegt bei 0,34. Das ist der einzige Hinweis auf den tatsächlichen Abo-Verbrauch, aber mit nur zwei Nachkommastellen zu grob für einzelne Aufgaben.

### 1.3 Nachrechnung mit der offiziellen Preistabelle

Haiku 5.5 (≤100k-Prompt): Input $0,10, 1h-Cache-Write $0,20, Cache-Hit $0,01, Output $0,50 pro MTok. Websuche $10 pro 1.000 Suchen.

| Test | Rechnung (µ$) | Ergebnis | CLI `costUSD` |
|---|---|---|---|
| 1 | 1159·0,10 + 23·0,50 + 649·0,01 + 2441·0,20 = 115,9 + 11,5 + 6,49 + 488,2 | 0,00062209 | 0,00062209 ✔ |
| 2 | 15428·0,10 + 2158·0,50 + 6289·0,01 + 3752·0,20 = 3435,09 µ$ + 1 Suche · $0,01 | 0,01343509 | 0,01343509 ✔ |

Daraus folgt:

- **Formel:** `costUSD = in·P_in + out·P_out + cacheRead·P_hit + cacheCreate·P_write(1h|5m) + webSearchRequests·0,01`.
- **Thinking-Tokens werden nicht zusätzlich berechnet.** Sie stecken in `outputTokens`, denn mit `thinkingTokens` als Extraposten ginge die Rechnung nicht auf. Das deckt sich mit der Doku: „Thinking tokens are billed as output tokens“.
- Bei Abo-Nutzung schreibt Claude Code die Caches mit **1h-TTL** (2× Input statt 1,25×). Die CLI rechnet diesen Aufschlag korrekt ein. In `modelUsage` gibt es jedoch nur `cacheCreationInputTokens` **ohne Aufteilung nach 5m und 1h**. Die Aufteilung liefert nur `usage.cache_creation`, und das gilt nur für die Hauptschleife. Eine eigene Preistabelle muss also annehmen, welche TTL gilt: bei Abo innerhalb des Kontingents 1h, bei Nutzung von Usage-Credits 5m.

## 2. Was sagen die Primärquellen?

- **Schätzung, keine Abrechnung:** „The `total_cost_usd` and `costUSD` fields are client-side estimates, not authoritative billing data. The SDK computes them locally from a price table bundled at build time“. Abweichungen sind möglich bei Preisänderungen, bei Modellen, die die CLI-Version nicht kennt, und bei Abrechnungsregeln, die der Client nicht abbildet ([Agent SDK, Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)).
- **Abo:** „Claude Max and Pro subscribers have usage included in their subscription, so the session cost figure isn't relevant for billing purposes.“ Claude Code berechnet den Betrag „locally from token counts at list price“ ([Manage costs](https://code.claude.com/docs/en/costs)). Bei Abo-Nutzung ist `total_cost_usd` also ein **API-Äquivalent zum Listenpreis**.
- **Subagents:** `usage` „Excluded. Counts only the top-level agent loop“. `total_cost_usd` und `modelUsage` sind „Included“. Die Doku rät: „Use `modelUsage` … for whole-tree token accounting“ (Quelle wie oben).
- **Output-Tokens pro Schritt:** „Per-step `output_tokens` is a placeholder, so read output tokens from the result message.“ Pro Schritt verlässlich sind nur Input- und Cache-Tokens, und auch das erst nach Deduplizierung über die Message-ID.
- **Fehlerfälle:** Auch Fehler-Results enthalten Kosten. Bei `error_max_budget_usd` fehlt der letzte Aufruf in `usage`, ist aber in `total_cost_usd` und `modelUsage` enthalten. Nach einem Absturz (`error_during_execution`) können alle Felder 0 sein.
- **`costBasis`** (`list` | `managed` | `unknown`) gibt es ab v2.1.246. `unknown` heißt, dass die CLI das Modell nicht kennt und der Preis damit unzuverlässig ist.
- **Datenresidenz:** Bei `inference_geo: "us"` gilt der Faktor 1,1 auf Tokens, aber nicht auf die Websuche.
- **Preise:** Websuche $10 pro 1.000 Suchen, Web-Fetch ohne Aufpreis (nur Tokens). Haiku 5.5 hat einen Long-Context-Tarif oberhalb von 100k Prompt-Tokens (5× teurer). Sonnet und Opus 5.5 haben Cache-Hits zu 0,05× ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
- **Changelog** (Belege dafür, dass sich die eingebaute Preistabelle und die Felder ändern):
  - 2.1.296: „Updated `/cost`, … and the SDK's cost figures to price Sonnet 5.5 cache reads at $0.10 per million tokens (was $0.20)“. Die eingebaute Tabelle war also zeitweise falsch.
  - 2.1.300: OTel-`api_request` erhält `cache_creation_5m_tokens` und `cache_creation_1h_tokens`.
  - 2.1.307: „Fixed subagent transcripts recording placeholder token usage …“
- **OpenTelemetry** ([Monitoring](https://code.claude.com/docs/en/monitoring-usage)):
  - Metriken: `claude_code.cost.usage` (USD) und `claude_code.token.usage` (`type`: `input` | `output` | `cacheRead` | `cacheCreation`), jeweils mit den Attributen `model`, `query_source` (`main` | `subagent` | `auxiliary`), `effort` und `session.id`.
  - Event `claude_code.api_request`: enthält pro API-Aufruf `cost_usd`, `cost_usd_micros`, Tokens inklusive 5m/1h-Split, `duration_ms` und `request_id`.
  - Aktivierung: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER=otlp|console`. Eigene Labels wie die Aufgaben-ID lassen sich über `OTEL_RESOURCE_ATTRIBUTES` mitgeben.
  - Auch `cost_usd` ist laut Doku „Estimated“, nutzt also dieselbe Preistabelle.

## 3. Transkripte (`~/.claude/projects/**/*.jsonl`)

- Jede Zeile ist ein Event. `assistant`-Einträge enthalten `message.usage` mit derselben Struktur wie oben. Einträge vom Typ `api-request` enthalten nur Request-Parameter und keine Token-Daten.
- Nachteile:
  1. Mit `--no-session-persistence`, wie es der bisherige Aufruf nutzt, **entsteht gar kein Transkript**.
  2. `output_tokens` pro Eintrag ist ein Platzhalter (siehe oben). Auswertungen im Stil von ccusage **unterschätzen die Output-Tokens** und damit auch das Thinking.
  3. Mehrere Einträge teilen sich eine Message-ID und müssen dedupliziert werden.
  4. Interne Hilfsaufrufe wie die Websuche oder `auxiliary`-Aufrufe tauchen nicht als eigene Einträge auf. Subagents liegen in separaten Dateien unter `<session>/subagents/`.
  5. Das Format ist intern und undokumentiert.
- Fazit: Transkripte eignen sich für dieses Ziel nicht.

## 4. Optionen

| | A: `total_cost_usd` übernehmen | B: `modelUsage` × eigene Preistabelle | C: OpenTelemetry | D: Transkript-Auswertung |
|---|---|---|---|---|
| **Datenquelle** | `result.total_cost_usd` | `result.modelUsage[*]` (Tokens, `webSearchRequests`) | `api_request`-Events bzw. Metriken über einen OTLP-Collector oder einen `console`-Exporter | `~/.claude/projects/*.jsonl` |
| **Vollständigkeit** | alles (Haupt-, Hilfs- und Subagent-Aufrufe, Websuche) | alles, aufgeteilt nach Modell | alles, pro API-Aufruf, mit `query_source` | unvollständig: keine Hilfsaufrufe, Output nur als Platzhalter |
| **Genauigkeit** | exakt gegenüber der Listenpreis-Formel der jeweiligen CLI-Version. Fehlerhaft, wenn die eingebaute Tabelle veraltet ist oder `costBasis = unknown` | genauso exakt, solange die Tabelle stimmt. Unbekannt bleibt nur die 5m/1h-Aufteilung bei Cache-Writes (Annahme nötig) | am genauesten: pro Request mit 5m/1h-Split und Effort-Attribut | schlecht |
| **Aufwand** | minimal (ein Feld) | gering: Tabelle mit etwa 4 Spalten pro Modell plus Websuchpreis, eine Funktion | mittel: Collector bzw. Exporter, Zuordnung über `session.id` oder eigene Resource-Attribute, Nachbearbeitung | mittel bis hoch, zudem nur ohne `--no-session-persistence` möglich |
| **Reproduzierbarkeit** | abhängig von der CLI-Version; alte Läufe bleiben auf alten Preisen stehen | Neuberechnung jederzeit möglich, z. B. bei Preisänderungen oder für Szenarien wie „Batch“ oder „5m-Cache“ | wie A, sofern die Rohdaten gespeichert werden | – |
| **Risiken** | stille Änderungen an der Preistabelle (z. B. 2.1.296), Abstürze mit Kosten 0 | Feldnamen in `modelUsage` können sich ändern (camelCase, nicht stabil dokumentiert), neue Preisdimensionen (Long-Context, Fast-Mode, `inference_geo`) | Schema-Änderungen bei OTel-Attributen (z. B. 2.1.300), zusätzliche Infrastruktur, Telemetrie kann versehentlich nach außen gelangen | internes Format, Platzhalter-Bug |
| **Abo-Bezug** | API-Äquivalent | API-Äquivalent | API-Äquivalent | Tokens (unvollständig) |

Ergänzende Option **E: Abo-Auslastung aus `rate_limit_event`.** `five_hour.utilization` bzw. `seven_day.utilization` vor und nach einer Aufgabe zeigt den echten Abo-Verbrauch. Mit nur zwei Nachkommastellen ist der Wert aber nur über viele Aufgaben hinweg aussagekräftig und wird durch parallele Nutzung verfälscht. Allenfalls als Zusatzmetrik pro Benchmark-Lauf geeignet.

## 5. Empfehlung

**B als Primärmetrik, A als Gegenprobe. C optional, falls später Details pro Request gebraucht werden.**

1. **Rohdaten vollständig speichern:**
   - aus `result`: `modelUsage` komplett, `total_cost_usd`, `usage`, `num_turns`, `duration_ms`, `duration_api_ms`, `subtype`, `is_error`, `subagent_stats`
   - dazu `claude_code_version` aus dem `system/init`-Event (nur mit verbose bzw. stream-json) oder aus `claude --version`
2. **Eigene, versionierte Preistabelle**, etwa als `pricing.ts` oder JSON mit `validFrom`. Pro Modell: `input`, `cacheWrite5m`, `cacheWrite1h`, `cacheHit`, `output`, gegebenenfalls `longContextThreshold` und den zugehörigen Tarif. Global: `webSearchPer1k = 10`.
3. **Kosten berechnen** mit `Σ_modelle (inputTokens·in + outputTokens·out + cacheReadInputTokens·hit + cacheCreationInputTokens·write1h) + webSearchRequests·0,01`. Für die TTL bei Abo 1h annehmen und die Annahme dokumentieren.
4. **Plausibilitätsprüfung:**
   - Weicht das Ergebnis um mehr als 1 % von `total_cost_usd` ab, oder ist `costBasis ≠ "list"` bzw. `"unknown"`, die Aufgabe markieren.
   - Kosten von 0 bei einem Fehler-Result als „unbekannt“ behandeln, nicht als 0.
5. **Plot-Achsen:** „Kosten (API-Äquivalent, Listenpreis)“ und alternativ „Gesamt-Tokens“. Thinking-Tokens nicht addieren, weil sie bereits in `outputTokens` enthalten sind, sondern höchstens als Anteil ausweisen.
6. **Parser robust bauen:**
   - Array- und Objekt-Ausgabe akzeptieren.
   - Fehlende Felder tolerieren, z. B. `thinkingTokens`, `costBasis`, `webSearchRequests`.
   - Nie `usage` auf oberster Ebene für Kosten verwenden.
   - Output-Tokens aus `assistant`-Events ignorieren.
7. **CLI-Version pinnen** bzw. pro Lauf protokollieren, und das Parsing nach Updates mit einem kurzen Haiku-Probeaufruf wie in 1.2 testen.

Begründung: B ist so genau wie A (empirisch identisch), aber unabhängig von Fehlern in der eingebauten Preistabelle und rückwirkend neu berechenbar. Der Aufwand ist gering, und die nötigen Daten liegen ohnehin im `result`. OTel bringt erst dann einen Mehrwert, wenn der Benchmark Kosten pro Request bzw. `query_source` oder einen exakten 5m/1h-Split braucht.

## Quellen

- https://code.claude.com/docs/en/agent-sdk/cost-tracking
- https://code.claude.com/docs/en/costs
- https://code.claude.com/docs/en/monitoring-usage
- https://code.claude.com/docs/en/changelog (Einträge 2.1.296, 2.1.300, 2.1.302, 2.1.307)
- https://platform.claude.com/docs/en/about-claude/pricing
- Eigene Testaufrufe mit CLI 2.1.309 am 2026-10-23 (Abo-Login, Modell `claude-haiku-5-5`)
