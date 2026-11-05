import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface ProcessSpec {
  /** Kurzname, steht vor jeder Ausgabezeile: `[name] …`. */
  name: string;
  command: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export interface RunTogetherOptions {
  /** Ziel der Ausgabezeilen (Standard `console.log`). */
  out?: (line: string) => void;
  /** Wartezeit nach SIGTERM, bevor noch laufende Prozessgruppen SIGKILL bekommen. */
  killAfterMs?: number;
}

export interface ProcessGroup {
  /** Beendet alle Prozesse samt Kindprozessen; `SIGKILL` sofort hart (z. B. beim zweiten Strg+C). */
  stop(signal?: "SIGTERM" | "SIGKILL"): void;
  /** Erfüllt sich, wenn alle Prozesse beendet sind: 0 nach `stop()`, sonst 1 bzw. der Exit-Code des Prozesses, der zuerst von selbst endete. */
  done: Promise<number>;
}

/**
 * Startet mehrere Prozesse gemeinsam und beendet sie gemeinsam: endet einer von selbst (Absturz, belegter
 * Port …), werden die übrigen gestoppt. Jeder Prozess läuft in einer eigenen Prozessgruppe, damit `stop()` auch
 * seine Kindprozesse erreicht (z. B. `pnpm` → `next dev`).
 */
export function runTogether(specs: readonly ProcessSpec[], options: RunTogetherOptions = {}): ProcessGroup {
  const out = options.out ?? ((line: string) => console.log(line));
  const killAfterMs = options.killAfterMs ?? 10_000;
  const running = new Map<string, ChildProcess>();
  let stopping = false;
  let exitCode = 0;
  let killTimer: NodeJS.Timeout | undefined;
  let resolveDone: (code: number) => void = () => {};
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  const signalGroup = (child: ChildProcess, signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Gruppe schon beendet.
    }
  };

  const stop = (signal: "SIGTERM" | "SIGKILL" = "SIGTERM") => {
    stopping = true;
    for (const child of running.values()) signalGroup(child, signal);
    if (signal === "SIGTERM" && !killTimer && running.size > 0) {
      killTimer = setTimeout(() => stop("SIGKILL"), killAfterMs);
      killTimer.unref();
    }
  };

  const finish = (spec: ProcessSpec, code: number | null, signal: NodeJS.Signals | null, error?: Error) => {
    const child = running.get(spec.name);
    if (!child) return;
    running.delete(spec.name);
    // Kindprozesse, die den Hauptprozess überleben (z. B. nach dessen Absturz), mitbeenden.
    signalGroup(child, "SIGKILL");
    if (!stopping) {
      const reason = error
        ? `konnte nicht starten: ${error.message}`
        : `beendet (${signal ?? `Code ${code}`})`;
      out(`[${spec.name}] ${reason} – beende die übrigen Prozesse.`);
      exitCode = code && code !== 0 ? code : 1;
      stop();
    }
    if (running.size === 0) {
      clearTimeout(killTimer);
      resolveDone(exitCode);
    }
  };

  for (const spec of specs) {
    const child = spawn(spec.command, [...spec.args], {
      env: spec.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    running.set(spec.name, child);
    for (const stream of [child.stdout, child.stderr]) {
      if (stream) createInterface({ input: stream }).on("line", (line) => out(`[${spec.name}] ${line}`));
    }
    child.once("error", (error) => finish(spec, null, null, error));
    child.once("exit", (code, signal) => finish(spec, code, signal));
  }
  if (running.size === 0) resolveDone(0);

  return { stop, done };
}
