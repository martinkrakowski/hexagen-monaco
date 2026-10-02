import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// The clock the pass and observe share. The mocked pass moves it, so the
// import pass can "take" any amount of time without a real wait.
const clock = vi.hoisted(() => ({ t: 0, after: 0 }));

vi.mock("../../../src/commands/observe/imports/pass.js", async (orig) => {
  const actual =
    await orig<
      typeof import("../../../src/commands/observe/imports/pass.js")
    >();
  return {
    ...actual,
    runImportPass: async (
      o: Parameters<typeof actual.runImportPass>[0],
    ): Promise<Awaited<ReturnType<typeof actual.runImportPass>>> => {
      const result = await actual.runImportPass(o);
      clock.t += clock.after;
      return result;
    },
  };
});

const { observe } = await import("../../../src/commands/observe/index.js");

const tmpDirs: string[] = [];

async function mkRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-deadline-"));
  tmpDirs.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"p"}');
  await fs.writeFile(path.join(root, "a.ts"), "// @generated\nimport './b';\n");
  await fs.writeFile(path.join(root, "b.ts"), "export {};\n");
  const g = (...args: string[]): void => {
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
      { cwd: root, stdio: "ignore" },
    );
  };
  g("init", "-q");
  g("add", "-A");
  g("commit", "-q", "-m", "fixture", "--no-gpg-sign");
  return root;
}

afterEach(async () => {
  clock.t = 0;
  clock.after = 0;
  while (tmpDirs.length) {
    await fs.rm(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("hexagen observe: deadlines", () => {
  it("an import pass that outlasts maxMs leaves generated collected (F3)", async () => {
    const root = await mkRepo();
    clock.after = 1_000_000;
    const report = await observe({
      root,
      maxMs: 1000,
      now: () => clock.t,
    });
    expect(report.generated.collected).toBe(true);
    expect(report.edges.collected).toBe(true);
    expect(report.limits.truncated).toBe(false);
  });

  it("the import pass runs on its own clock, not the walk's (F12)", async () => {
    const root = await mkRepo();
    // Every clock read costs 600 ms. The pass itself reads the clock three
    // times (1200 ms elapsed), under maxImportMs, but many reads happened
    // between the start of the run and the start of the pass.
    let t = 0;
    const report = await observe({
      root,
      maxMs: 10_000_000,
      maxImportMs: 1300,
      now: () => (t += 600),
    });
    expect(report.edges.collected).toBe(true);
  });
});
