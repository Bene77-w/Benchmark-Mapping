/**
 * Zeichnet eine echte Ausgabe der OpenCode-CLI als Fixture für die Adapter-Tests (Seam 3) auf.
 *
 *   pnpm exec tsx scripts/record-opencode-fixture.ts <name> <unit_id>
 *     [--mode text_only|web] [--model deepseek/deepseek-flash] [--effort default]
 *
 * Schreibt tests/fixtures/harness/opencode/<name>.stdout (+ .stderr), <name>.export.json (`session export`)
 * und <name>.meta.json. Der Aufruf ist exakt der des Adapters (runOpencodeCall: Argumente, Konfiguration,
 * stdin, leeres Arbeitsverzeichnis, isolierte Konfiguration; die Sitzung wird danach gelöscht). Alles wird mit
 * scrubOpencodeFixture bereinigt; vor dem Commit trotzdem auf Secrets prüfen.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { runCli } from "@/server/harness/cli-process";
import { scrubOpencodeFixture } from "@/server/harness/opencode-output";
import { runOpencodeCall } from "@/server/harness/opencode-sandbox";
import { buildBenchmarkPrompt, type Mode } from "@/server/prompt/benchmark-prompt";
import { readSnapshotFile } from "@/server/snapshot/snapshot-file";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "text_only" },
    model: { type: "string", default: "deepseek/deepseek-flash" },
    effort: { type: "string", default: "default" },
  },
});
const [name, unitId] = positionals;
if (!name || !unitId) throw new Error("Aufruf: record-opencode-fixture.ts <name> <unit_id> [--mode …]");
const mode = values.mode as Mode;

const snapshot = await readSnapshotFile("data/snapshot/snapshot.json");
const prompt = await buildBenchmarkPrompt(snapshot, { runKind: "benchmark", mode });
const unit = prompt.forUnit(unitId, { inlineSchema: true });
const call = await runOpencodeCall(
  {
    systemPrompt: unit.systemPrompt,
    userPrompt: unit.userPrompt,
    outputSchema: prompt.outputSchema,
    formatInstruction: prompt.formatInstruction,
    model: values.model,
    effort: values.effort,
    mode,
    timeoutMs: 10 * 60_000,
  },
  { runCli, env: process.env, websearchProvider: process.env.OPENCODE_WEBSEARCH_PROVIDER || null },
);

const base = path.join("tests/fixtures/harness/opencode", name);
await writeFile(`${base}.stdout`, scrubOpencodeFixture(call.cli.stdout));
if (call.cli.stderr) await writeFile(`${base}.stderr`, scrubOpencodeFixture(call.cli.stderr));
if (call.exported !== null) await writeFile(`${base}.export.json`, scrubOpencodeFixture(call.exported));
const meta = {
  recordedAt: new Date().toISOString().slice(0, 10),
  constructed: false,
  command: scrubOpencodeFixture(call.commandLine).replace(
    /benchmark-mapping-[0-9a-f]{12}/,
    "benchmark-mapping-<id>",
  ),
  task: { unitId, model: values.model, effort: values.effort, mode, promptVersion: prompt.version },
  exitCode: call.cli.exitCode,
  timedOut: call.cli.timedOut,
  durationMs: Math.round(call.cli.durationMs),
};
await writeFile(`${base}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
console.log(call.cleanup.join("\n"));
console.log(`Geschrieben: ${base}.* (Exit ${call.cli.exitCode}, ${Math.round(call.cli.durationMs)} ms)`);
