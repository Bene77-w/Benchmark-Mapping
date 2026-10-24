/**
 * Zeichnet eine echte Ausgabe der Codex-CLI als Fixture für die Adapter-Tests (Seam 3) auf.
 *
 *   CODEX_AUTH_HOME=~/.codex-b pnpm exec tsx scripts/record-codex-fixture.ts <name> <unit_id>
 *     [--mode text_only|web] [--model gpt-6-luna] [--effort low]
 *
 * Schreibt tests/fixtures/harness/codex/<name>.stdout (+ .stderr), <name>.last-message (Antwortdatei),
 * <name>.rollout.jsonl (Rollout-Log) und <name>.meta.json. Der Aufruf ist exakt der des Adapters
 * (runCodexCall: Argumente, stdin, leeres Arbeitsverzeichnis, temporäres CODEX_HOME mit Symlink auf die
 * Anmeldung). Alles wird mit scrubCodexFixture bereinigt; vor dem Commit trotzdem auf Secrets prüfen.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { runCli } from "@/server/harness/cli-process";
import { scrubCodexFixture } from "@/server/harness/codex-output";
import { runCodexCall } from "@/server/harness/codex-sandbox";
import { buildBenchmarkPrompt, type Mode } from "@/server/prompt/benchmark-prompt";
import { readSnapshotFile } from "@/server/snapshot/snapshot-file";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "text_only" },
    model: { type: "string", default: "gpt-6-luna" },
    effort: { type: "string", default: "low" },
  },
});
const [name, unitId] = positionals;
if (!name || !unitId) throw new Error("Aufruf: record-codex-fixture.ts <name> <unit_id> [--mode …]");
const mode = values.mode as Mode;

const snapshot = await readSnapshotFile("data/snapshot/snapshot.json");
const prompt = await buildBenchmarkPrompt(snapshot, { runKind: "benchmark", mode });
const unit = prompt.forUnit(unitId);
const call = await runCodexCall(
  {
    systemPrompt: unit.systemPrompt,
    userPrompt: unit.userPrompt,
    outputSchema: prompt.outputSchema,
    model: values.model,
    effort: values.effort,
    mode,
    timeoutMs: 10 * 60_000,
  },
  { runCli, env: process.env },
);
if (call.authMissing) throw new Error(call.authMissing);

const base = path.join("tests/fixtures/harness/codex", name);
await writeFile(`${base}.stdout`, scrubCodexFixture(call.cli.stdout));
if (call.cli.stderr) await writeFile(`${base}.stderr`, scrubCodexFixture(call.cli.stderr));
if (call.lastMessage !== null) await writeFile(`${base}.last-message`, scrubCodexFixture(call.lastMessage));
if (call.rollout !== null) await writeFile(`${base}.rollout.jsonl`, scrubCodexFixture(call.rollout));
const meta = {
  recordedAt: new Date().toISOString().slice(0, 10),
  constructed: false,
  command: call.commandLine,
  task: { unitId, model: values.model, effort: values.effort, mode, promptVersion: prompt.version },
  exitCode: call.cli.exitCode,
  timedOut: call.cli.timedOut,
  durationMs: Math.round(call.cli.durationMs),
};
await writeFile(`${base}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
console.log(`Geschrieben: ${base}.* (Exit ${call.cli.exitCode}, ${Math.round(call.cli.durationMs)} ms)`);
