import { type Mode, withInlineSchema } from "@/server/prompt/benchmark-prompt";
import type { JsonSchema } from "@/server/prompt/output-schema";

/**
 * Aufruf von `opencode run` (v2) und die Konfiguration, die der Adapter dafür in ein temporäres
 * Konfigurationsverzeichnis schreibt (siehe opencode-sandbox.ts).
 *
 * - `--standalone`: eigener, privater Server statt des Hintergrunddienstes des Nutzers (der Dienst würde mit der
 *   Umgebung des ersten Aufrufs weiterlaufen und den festen Port belegen).
 * - `--agent benchmark`: eigener Agent aus der temporären Konfiguration. Sein `system` ersetzt den Basis-Prompt
 *   von OpenCode; er enthält den Benchmark-Prompt, den versionierten Formatierungsauftrag
 *   (`format-instruction.md`) und das Ausgabeschema (OpenCode kennt in v2 keine Schema-Option). Der Auftrag
 *   steht im gemeinsamen Prompt-Hash, der ganze Text im Unit-Hash (`withInlineSchema`).
 * - Berechtigungen: alles verboten (`*`), im Modus mit Web nur `websearch` erlaubt; `websearch: false` nimmt
 *   das Suchwerkzeug im Modus ohne Web ganz aus den Anfragen.
 * - Modell `provider/model#variant`: der Effort ist die Variante; Effort `default` ruft ohne Variante auf
 *   (OpenCode meldet dann selbst `default`).
 * - Die Daten der Unit (User-Prompt) kommen über stdin.
 */

export const OPENCODE_AGENT = "benchmark";

/** Effort, bei dem kein `#variant` angehängt wird. */
export const DEFAULT_VARIANT = "default";

/** Ausgabeschema samt Formatierungsauftrag für den System-Prompt. */
export interface InlineSchema {
  formatInstruction: string;
  outputSchema: JsonSchema;
}

/** System-Prompt des Agents: ohne Schema (Preflight-Probe) der Prompt selbst, sonst `withInlineSchema`. */
export function opencodeSystemPrompt(systemPrompt: string, inline: InlineSchema | null): string {
  if (!inline) return systemPrompt;
  return withInlineSchema(systemPrompt, inline.formatInstruction, inline.outputSchema);
}

export function opencodeModelRef(model: string, effort: string): string {
  return effort === "" || effort === DEFAULT_VARIANT ? model : `${model}#${effort}`;
}

export interface OpencodeCall {
  model: string;
  effort: string;
  title: string;
}

export function buildOpencodeArgs(call: OpencodeCall): string[] {
  return [
    "run",
    "--standalone",
    "--format",
    "json",
    "--agent",
    OPENCODE_AGENT,
    "-m",
    opencodeModelRef(call.model, call.effort),
    "--title",
    call.title,
  ];
}

export interface OpencodeConfigInput {
  systemPrompt: string;
  mode: Mode;
  /** Suchanbieter (`exa`, `tavily`, …, `random`) im Modus mit Web. */
  websearchProvider: string | null;
}

/** Inhalt von `<config>/opencode/opencode.json`. */
export function buildOpencodeConfig(input: OpencodeConfigInput): Record<string, unknown> {
  const web = input.mode === "web";
  const permissions = [
    { action: "*", resource: "*", effect: "deny" },
    ...(web ? [{ action: "websearch", resource: "*", effect: "allow" }] : []),
  ];
  return {
    update: "disable",
    snapshots: false,
    formatter: false,
    websearch: web ? { provider: input.websearchProvider ?? "random" } : false,
    default_agent: OPENCODE_AGENT,
    permissions,
    agents: {
      [OPENCODE_AGENT]: {
        mode: "primary",
        description: "Benchmark-Mapping: eine Unit zuordnen",
        system: input.systemPrompt,
        permissions,
      },
    },
  };
}

/** Argumente fürs Protokoll: temporäre Pfade durch Platzhalter ersetzt. */
export function describeOpencodeArgs(args: string[], root: string): string {
  return args
    .map((arg) => (root ? arg.replaceAll(root, "<tmp>") : arg))
    .map((arg) => (arg === "" || /[\s"#]/.test(arg) ? `'${arg}'` : arg))
    .join(" ");
}
