import os from "node:os";
import { describe, expect, test } from "vitest";
import { isolatedEnv, runCli } from "./cli-process";

/** Prozessstart der echten Adapter, geprüft mit Node als Stellvertreter-CLI (keine Agent-CLI). */
const node = process.execPath;
const base = { cwd: os.tmpdir(), env: { PATH: process.env.PATH }, timeoutMs: 10_000 };

describe("runCli", () => {
  test("reicht stdin durch und liefert stdout, stderr und Exit-Code", async () => {
    const outcome = await runCli({
      ...base,
      command: node,
      args: [
        "-e",
        "process.stdin.pipe(process.stdout); process.stderr.write('hinweis'); process.exitCode = 3",
      ],
      stdin: "Eingabe",
    });
    expect(outcome).toMatchObject({ stdout: "Eingabe", stderr: "hinweis", exitCode: 3, timedOut: false });
  });

  test("bricht nach dem Timeout ab und meldet timedOut", async () => {
    const outcome = await runCli({
      ...base,
      command: node,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      timeoutMs: 200,
    });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.durationMs).toBeLessThan(5_000);
  });

  test("meldet eine nicht vorhandene CLI als Startfehler", async () => {
    const outcome = await runCli({ ...base, command: "gibt-es-nicht-cli-xyz", args: [] });
    expect(outcome.spawnError).toContain("ENOENT");
    expect(outcome.exitCode).toBeNull();
  });
});

test("isolatedEnv übernimmt nur die Positivliste und Zusätze", () => {
  expect(
    isolatedEnv({ HOME: "/h", PATH: "/p", DATABASE_URL: "x", CODEX_HOME: "/c" }, ["CODEX_HOME"], { A: "1" }),
  ).toEqual({ HOME: "/h", PATH: "/p", CODEX_HOME: "/c", A: "1" });
});
