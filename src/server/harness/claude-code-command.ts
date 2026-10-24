import type { Mode } from "@/server/prompt/benchmark-prompt";
import type { JsonSchema } from "@/server/prompt/output-schema";

/**
 * Aufruf von Claude Code, isoliert wie im Submapper: `--safe-mode` hält CLAUDE.md, Skills, Plugins, Hooks
 * und MCP-Server draußen, `--strict-mcp-config` ohne `--mcp-config` lädt keinen MCP-Server, `--system-prompt`
 * ersetzt den Coding-Systemprompt durch den Benchmark-Prompt, und `--tools` lässt nur die Websuche übrig
 * (Modus mit Web) bzw. gar kein Werkzeug (leerer Wert). Keine Datei-, Bash- oder Editierwerkzeuge.
 * `--verbose` macht die Ausgabe unabhängig von der Nutzereinstellung zum Event-Array (mit `system/init` und
 * `rate_limit_event`). Der User-Prompt geht über stdin, damit seine Länge nicht an die Argumentgrenze stößt.
 */
export const CLAUDE_WEB_TOOLS = ["WebSearch", "WebFetch"] as const;

export interface ClaudeCall {
  systemPrompt: string;
  /** Ohne Schema antwortet die CLI frei (Preflight-Probe). */
  outputSchema: JsonSchema | null;
  model: string;
  effort: string;
  mode: Mode;
}

export function buildClaudeArgs(call: ClaudeCall): string[] {
  return [
    "-p",
    "--system-prompt",
    call.systemPrompt,
    ...(call.outputSchema ? ["--json-schema", JSON.stringify(call.outputSchema)] : []),
    "--output-format",
    "json",
    "--verbose",
    "--model",
    call.model,
    "--effort",
    call.effort,
    "--tools",
    call.mode === "web" ? CLAUDE_WEB_TOOLS.join(",") : "",
    "--safe-mode",
    "--no-session-persistence",
    "--strict-mcp-config",
  ];
}

/** Argumente fürs Protokoll: lange Texte (System-Prompt, Schema) nur mit Länge. */
export function describeArgs(args: string[]): string {
  return args
    .map((arg, index) => {
      const flag = args[index - 1];
      if (flag === "--system-prompt" || flag === "--json-schema") return `<${arg.length} Zeichen>`;
      return arg === "" || /\s/.test(arg) ? JSON.stringify(arg) : arg;
    })
    .join(" ");
}
