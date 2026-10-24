import type { Mode } from "@/server/prompt/benchmark-prompt";

/**
 * Aufruf von `codex exec`, isoliert wie im Submapper: `--ignore-user-config` hält die `config.toml` draußen
 * (Modell und Effort kommen nur aus den Argumenten), `--ignore-rules` die execpolicy-Regeln, `--sandbox
 * read-only` und das leere Arbeitsverzeichnis (`-C`) jede Projektdatei. Das temporäre `CODEX_HOME` (siehe
 * codex.ts) enthält nur den Symlink auf die Anmeldung, also keine AGENTS.md, Skills oder MCP-Server.
 * Zusätzlich sind die Werkzeuge abgeschaltet, die die Aufgabe nicht braucht (Shell, Plugins, Apps,
 * Unteragenten, Bilder, Browser, Hooks). Die Websuche kommt über `-c tools.web_search=<true|false>`.
 *
 * Codex exec kennt keinen eigenen Systemprompt; wie im Submapper steht der Benchmark-Prompt deshalb am Anfang
 * derselben Eingabe (stdin, `-`). Die Antwort steht in der Datei von `--output-last-message`, das Schema in
 * der Datei von `--output-schema`; `--json` liefert die Events (Tokens, Websuchen, Fehler) auf stdout.
 */
export const CODEX_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "multi_agent",
  "multi_agent_v2",
  "image_generation",
  "browser_use",
  "computer_use",
  "hooks",
  "view_image",
  "memories",
  "skill_search",
  "tool_suggest",
] as const;

export interface CodexCall {
  model: string;
  effort: string;
  mode: Mode;
  /** Datei mit dem Ausgabeschema; ohne Schema antwortet die CLI frei (Preflight-Probe). */
  schemaPath: string | null;
  answerPath: string;
  workdir: string;
}

export function buildCodexArgs(call: CodexCall): string[] {
  return [
    "exec",
    ...(call.schemaPath ? ["--output-schema", call.schemaPath] : []),
    "--output-last-message",
    call.answerPath,
    "--json",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "-c",
    `tools.web_search=${call.mode === "web" ? "true" : "false"}`,
    "--color",
    "never",
    "-C",
    call.workdir,
    "-m",
    call.model,
    "-c",
    `model_reasoning_effort="${call.effort}"`,
    "-",
  ];
}

/** Prompt über stdin: Benchmark-Prompt (System) und Daten der Unit (User) hintereinander. */
export function codexStdin(systemPrompt: string, userPrompt: string): string {
  return `${systemPrompt}\n\n${userPrompt}`;
}

/** Argumente fürs Protokoll: temporäre Pfade durch Platzhalter ersetzt. */
export function describeCodexArgs(args: string[], root: string): string {
  return args
    .map((arg) => (root ? arg.replaceAll(root, "<tmp>") : arg))
    .map((arg) => (arg === "" || /[\s"]/.test(arg) ? `'${arg}'` : arg))
    .join(" ");
}
