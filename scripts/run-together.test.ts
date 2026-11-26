import { describe, expect, test } from "vitest";
import { type ProcessSpec, runTogether } from "./run-together";

const node = (name: string, script: string): ProcessSpec => ({
  name,
  command: process.execPath,
  args: ["-e", script],
});
const FOREVER = "setInterval(() => {}, 1000);";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("Bedingung nicht erfüllt");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("runTogether", () => {
  test("stellt jeder Ausgabezeile den Namen voran", async () => {
    const lines: string[] = [];
    const group = runTogether([node("app", `console.log("bereit"); ${FOREVER}`)], {
      out: (l) => lines.push(l),
    });
    await waitFor(() => lines.includes("[app] bereit"));
    group.stop();
    await expect(group.done).resolves.toBe(0);
  });

  test("endet ein Prozess von selbst, werden die übrigen beendet und der Exit-Code weitergegeben", async () => {
    const lines: string[] = [];
    const group = runTogether(
      [node("app", "setTimeout(() => process.exit(3), 100);"), node("worker", FOREVER)],
      {
        out: (l) => lines.push(l),
      },
    );
    await expect(group.done).resolves.toBe(3);
    expect(lines).toContain("[app] beendet (Code 3) – beende die übrigen Prozesse.");
  });

  test("ein Prozess, der sich ohne Fehler beendet, gilt trotzdem als Abbruch", async () => {
    const group = runTogether([node("app", "setTimeout(() => {}, 50);"), node("worker", FOREVER)], {
      out: () => {},
    });
    await expect(group.done).resolves.toBe(1);
  });

  test("stop() beendet auch Kindprozesse der gestarteten Prozesse", async () => {
    const lines: string[] = [];
    const parent = `const c = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(FOREVER)}], { stdio: "ignore" }); console.log("kind " + c.pid); ${FOREVER}`;
    const group = runTogether([node("app", parent)], { out: (l) => lines.push(l) });
    await waitFor(() => lines.some((l) => l.startsWith("[app] kind ")));
    const pid = Number(lines.find((l) => l.startsWith("[app] kind "))?.split(" ")[2]);
    expect(isAlive(pid)).toBe(true);
    group.stop();
    await expect(group.done).resolves.toBe(0);
    await waitFor(() => !isAlive(pid));
  });

  test("wer SIGTERM ignoriert, bekommt nach der Wartezeit SIGKILL", async () => {
    const lines: string[] = [];
    const group = runTogether(
      [node("worker", `process.on("SIGTERM", () => {}); console.log("bereit"); ${FOREVER}`)],
      { out: (l) => lines.push(l), killAfterMs: 200 },
    );
    await waitFor(() => lines.includes("[worker] bereit"));
    group.stop();
    await expect(group.done).resolves.toBe(0);
  });

  test("lässt sich ein Befehl nicht starten, werden die übrigen beendet", async () => {
    const lines: string[] = [];
    const group = runTogether(
      [{ name: "app", command: "gibt-es-nicht-xyz", args: [] }, node("worker", FOREVER)],
      { out: (l) => lines.push(l) },
    );
    await expect(group.done).resolves.toBe(1);
    expect(lines.some((l) => l.startsWith("[app] konnte nicht starten:"))).toBe(true);
  });
});
