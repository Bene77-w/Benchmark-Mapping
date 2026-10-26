import type { ResolvedOpencodeOptions } from "./opencode";
import { NO_SEARCH_PROVIDER, opencodeVersion, outcomeOf } from "./opencode";
import { DEFAULT_VARIANT, OPENCODE_AGENT } from "./opencode-command";
import { type OpencodeExport, readOpencodeExport, readOpencodeStream } from "./opencode-output";
import {
  type OpencodeCallResult,
  runOpencodeCall,
  SEARCH_PROVIDER_ENV,
  withOpencodeSandbox,
} from "./opencode-sandbox";
import { type PreflightOptions, type PreflightRequest, type PreflightStep, runPreflight } from "./preflight";

/**
 * Preflight des OpenCode-Adapters. Reihenfolge so, dass Fehler ohne Modellaufruf zuerst auffallen:
 *
 *   cli              `opencode --version`
 *   auth             `auth list --format json`: Anmeldung für den Provider des Modells vorhanden (nur IDs)
 *   search_provider  nur Modus mit Web: Suchanbieter eingerichtet (`OPENCODE_WEBSEARCH_PROVIDER`, ggf. Schlüssel)
 *   model            kleine Probe mit Modell und Variante der Konfiguration (ohne Schema-Anhang)
 *   effort           Variante laut Sitzungsexport = angeforderter Effort
 *   isolation        Agent `benchmark`, keine Werkzeuge außer `websearch` (nur mit Web)
 *   session          Probe-Sitzung exportiert und gelöscht
 *   web_search       nur Modus mit Web: die Probe hat mindestens einmal gesucht
 */

/** Suchanbieter, die ohne eigenen Schlüssel arbeiten (Exa auf diesem Rechner geprüft, TinyFish laut Doku). */
const KEYLESS_PROVIDERS = new Set(["exa", "tinyfish", "random"]);

const PROBE = {
  text_only: {
    systemPrompt: "Du bist ein Funktionstest. Antworte nur mit: ok",
    userPrompt: "Funktionstest",
  },
  web: {
    systemPrompt:
      "Du bist ein Funktionstest der Websuche. Führe genau eine Websuche nach „United States Congress“ aus und antworte danach nur mit: ok",
    userPrompt: "Funktionstest Websuche",
  },
} as const;

/** `preflightOptions.signal` beendet Version, Anmeldung und Probe; das Aufräumen der Probe-Sitzung läuft weiter. */
export async function opencodePreflight(
  request: PreflightRequest,
  options: ResolvedOpencodeOptions,
  preflightOptions: PreflightOptions = {},
) {
  const { signal } = preflightOptions;
  const timeoutMs = options.preflightTimeoutMs;
  const web = request.mode === "web";
  const provider = request.model.split("/")[0] ?? "";
  let cliVersion: string | null = null;
  let integrations: string[] = [];
  let probe: { call: OpencodeCallResult; exported: OpencodeExport | null } | null = null;

  const steps: PreflightStep[] = [
    {
      id: "cli",
      label: "CLI erreichbar",
      async run() {
        const { version, error } = await opencodeVersion(options, signal);
        if (!version) return { status: "failed", message: error ?? "Version unbekannt" };
        cliVersion = version;
        return { status: "ok", message: `OpenCode ${version}` };
      },
    },
    {
      id: "auth",
      label: "Anmeldung des Providers",
      async run() {
        const cli = await withOpencodeSandbox(
          options.env,
          { update: "disable" },
          ({ workdir, env }) =>
            options.runCli({
              command: options.command,
              args: ["auth", "list", "--standalone", "--format", "json"],
              cwd: workdir,
              env,
              timeoutMs,
              signal,
            }),
          options.dataHome,
        );
        if (cli.exitCode !== 0) {
          return {
            status: "failed",
            message: `auth list scheiterte (Exit-Code ${cli.exitCode ?? "–"}): ${(cli.spawnError || cli.stderr).trim().slice(-300)}`,
          };
        }
        integrations = readIntegrationIds(cli.stdout);
        if (!integrations.includes(provider)) {
          return {
            status: "failed",
            message: `keine Anmeldung für Provider „${provider}“ (vorhanden: ${integrations.join(", ") || "keine"}); mit \`opencode auth login\` einrichten oder OPENCODE_DATA_HOME prüfen`,
          };
        }
        return { status: "ok", message: `Anmeldung für ${provider} vorhanden` };
      },
    },
    {
      id: "search_provider",
      label: "Suchanbieter",
      async run() {
        if (!web) return { status: "skipped", message: "nicht nötig im Modus ohne Web" };
        const search = options.websearchProvider;
        if (!search) return { status: "failed", message: NO_SEARCH_PROVIDER };
        const keyVar = SEARCH_PROVIDER_ENV[search];
        if (!keyVar && !KEYLESS_PROVIDERS.has(search)) {
          return { status: "failed", message: `unbekannter Suchanbieter „${search}“` };
        }
        if (KEYLESS_PROVIDERS.has(search)) {
          return { status: "ok", message: `Suchanbieter ${search} (ohne eigenen Schlüssel)` };
        }
        if (options.env[keyVar])
          return { status: "ok", message: `Suchanbieter ${search}, Schlüssel über ${keyVar}` };
        if (integrations.includes(search)) {
          return { status: "ok", message: `Suchanbieter ${search}, Anmeldung in OpenCode` };
        }
        return {
          status: "failed",
          message: `Suchanbieter ${search} ohne Schlüssel: ${keyVar} setzen oder in OpenCode anmelden`,
        };
      },
    },
    {
      id: "model",
      label: "Modell, Variante und Anmeldung",
      async run() {
        const call = await runOpencodeCall(
          { ...PROBE[request.mode], outputSchema: null, ...request, timeoutMs, signal },
          options,
        );
        const stream = readOpencodeStream(call.cli.stdout);
        const exported = readOpencodeExport(call.exported);
        probe = { call, exported };
        const outcome = outcomeOf(
          { unitId: "preflight", timeoutMs },
          call,
          stream,
          exported,
          exported?.text ?? stream.text,
        );
        if (outcome.kind === "rate_limit")
          return { status: "failed", message: `Ratenlimit erreicht: ${outcome.message}` };
        // Die Probe antwortet frei („ok“); kein JSON ist hier kein Fehler.
        if (
          outcome.kind !== "answer" &&
          outcome.kind !== "invalid_json" &&
          outcome.kind !== "schema_violation"
        )
          return { status: "failed", message: outcome.message };
        return { status: "ok", message: `${exported?.model ?? request.model} antwortet` };
      },
    },
    {
      id: "effort",
      label: "Variante bestätigt",
      async run() {
        const variant = probe?.exported?.variant ?? null;
        const expected = request.effort || DEFAULT_VARIANT;
        if (!variant)
          return {
            status: "warning",
            message: "keine Variante im Sitzungsexport; Läufe bleiben unbestätigt",
          };
        if (variant !== expected) {
          return {
            status: "failed",
            message: `OpenCode wendet Variante ${variant} an, angefordert war ${expected}`,
          };
        }
        return { status: "ok", message: `Variante ${variant} laut Sitzungsexport angewendet` };
      },
    },
    {
      id: "isolation",
      label: "Isolation",
      async run() {
        const exported = probe?.exported;
        if (!exported) return { status: "warning", message: "nicht prüfbar: kein Sitzungsexport" };
        const foreign = exported.tools.filter((tool) => !(web && tool === "websearch"));
        if (exported.agent !== OPENCODE_AGENT || foreign.length > 0) {
          return {
            status: "failed",
            message: `Agent ${exported.agent ?? "–"}, unerlaubte Werkzeuge: ${foreign.join(", ") || "keine"}`,
          };
        }
        return {
          status: "ok",
          message: `Agent ${OPENCODE_AGENT} mit eigenem System-Prompt; Werkzeuge: ${web ? "nur websearch" : "keine"}`,
        };
      },
    },
    {
      id: "session",
      label: "Temporäre Sitzung gelöscht",
      async run() {
        const call = probe?.call;
        if (!call?.sessionId) return { status: "warning", message: "keine Sitzung entstanden" };
        if (!call.sessionDeleted) return { status: "failed", message: call.cleanup.join("; ") };
        return { status: "ok", message: "Probe-Sitzung exportiert und gelöscht" };
      },
    },
    {
      id: "web_search",
      label: "Websuche",
      async run() {
        if (!web) return { status: "skipped", message: "nicht nötig im Modus ohne Web" };
        const searches = probe?.exported?.webSearches ?? 0;
        if (searches < 1) return { status: "failed", message: "die Probe hat keine Websuche ausgeführt" };
        return { status: "ok", message: `${searches} Websuche(n) in der Probe ausgeführt` };
      },
    },
  ];
  return runPreflight(steps, () => cliVersion, preflightOptions);
}

/** IDs aus `auth list --format json` (Namen und Verbindungen werden nicht ausgewertet). */
function readIntegrationIds(stdout: string): string[] {
  try {
    const list: unknown = JSON.parse(stdout);
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry) =>
      typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string"
        ? [(entry as { id: string }).id]
        : [],
    );
  } catch {
    return [];
  }
}
