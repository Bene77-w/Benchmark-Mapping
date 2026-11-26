import os from "node:os";
import { describe, expect, test } from "vitest";
import { isolatedEnv, killRunningClis, runCli } from "./cli-process";

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

  test("killRunningClis beendet laufende Aufrufe samt deren Kindprozessen", async () => {
    const forever = "setInterval(() => {}, 1000)";
    const running = runCli({
      ...base,
      command: node,
      args: [
        "-e",
        `const c = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(forever)}], { stdio: "ignore" }); console.log(c.pid); ${forever}`,
      ],
      timeoutMs: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(killRunningClis("SIGKILL")).toBe(1);
    const outcome = await running;
    expect(outcome.exitCode).toBeNull();
    expect(outcome.durationMs).toBeLessThan(5_000);
    const grandchild = Number(outcome.stdout.trim());
    const alive = () => {
      try {
        process.kill(grandchild, 0);
        return true;
      } catch {
        return false;
      }
    };
    // Unter Last braucht das Ende des Enkelprozesses mitunter länger als ein fester Zeitraum.
    for (let waited = 0; alive() && waited < 3_000; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(alive()).toBe(false);
    expect(killRunningClis("SIGTERM")).toBe(0);
  });
});

test("isolatedEnv übernimmt nur die Positivliste und Zusätze", () => {
  expect(
    isolatedEnv({ HOME: "/h", PATH: "/p", DATABASE_URL: "x", CODEX_HOME: "/c" }, ["CODEX_HOME"], { A: "1" }),
  ).toEqual({ HOME: "/h", PATH: "/p", CODEX_HOME: "/c", A: "1" });
});

test("runCli beendet den Prozess bei Abbruch über das Signal", async () => {
  const controller = new AbortController();
  const pending = runCli({
    cwd: os.tmpdir(),
    env: { PATH: process.env.PATH },
    timeoutMs: 30_000,
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 60000)"],
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  const outcome = await pending;
  expect(outcome).toMatchObject({ aborted: true, timedOut: false });
  expect(outcome.durationMs).toBeLessThan(5_000);
});
