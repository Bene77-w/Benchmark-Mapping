/**
 * Zeichnet eine echte Ausgabe von Claude Code als Fixture für die Adapter-Tests (Seam 3) auf.
 *
 *   pnpm exec tsx scripts/record-claude-fixture.ts <name> <unit_id> [--mode text_only|web]
 *     [--model haiku] [--effort low]
 *
 * Schreibt tests/fixtures/harness/claude-code/<name>.stdout (+ .stderr, falls vorhanden) und <name>.meta.json.
 * Der Aufruf ist exakt der des Adapters (Argumente, stdin, leeres Arbeitsverzeichnis, gefilterte Umgebung).
 * Vor dem Commit prüfen: keine Tokens, Session-IDs oder Pfade mit Nutzerdaten (siehe scrubFixture).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { claudeInvocation, scrubFixture } from "@/server/harness/claude-code";
import { describeArgs } from "@/server/harness/claude-code-command";
import { runCli, withEmptyWorkdir } from "@/server/harness/cli-process";
import { buildBenchmarkPrompt, type Mode } from "@/server/prompt/benchmark-prompt";
import { readSnapshotFile } from "@/server/snapshot/snapshot-file";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "text_only" },
    model: { type: "string", default: "haiku" },
    effort: { type: "string", default: "low" },
  },
});
const [name, unitId] = positionals;
if (!name || !unitId) throw new Error("Aufruf: record-claude-fixture.ts <name> <unit_id> [--mode …]");
const mode = values.mode as Mode;

const snapshot = await readSnapshotFile("data/snapshot/snapshot.json");
const prompt = await buildBenchmarkPrompt(snapshot, { runKind: "benchmark", mode });
const unit = prompt.forUnit(unitId);
const task = {
  unitId,
  systemPrompt: unit.systemPrompt,
  userPrompt: unit.userPrompt,
  outputSchema: prompt.outputSchema,
  model: values.model,
  effort: values.effort,
  mode,
  timeoutMs: 10 * 60_000,
};

const outcome = await withEmptyWorkdir("benchmark-claude", (cwd) =>
  runCli(claudeInvocation(task, { cwd, env: process.env })),
);
const dir = "tests/fixtures/harness/claude-code";
const base = path.join(dir, name);
await writeFile(`${base}.stdout`, scrubFixture(outcome.stdout));
if (outcome.stderr) await writeFile(`${base}.stderr`, scrubFixture(outcome.stderr));
const meta = {
  recordedAt: new Date().toISOString().slice(0, 10),
  constructed: false,
  command: `claude ${describeArgs(claudeInvocation(task, { cwd: "", env: {} }).args)}`,
  task: { unitId, model: task.model, effort: task.effort, mode, promptVersion: prompt.version },
  exitCode: outcome.exitCode,
  timedOut: outcome.timedOut,
  durationMs: Math.round(outcome.durationMs),
};
await writeFile(`${base}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
console.log(`Geschrieben: ${base}.* (Exit ${outcome.exitCode}, ${Math.round(outcome.durationMs)} ms)`);
