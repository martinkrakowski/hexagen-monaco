import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

/**
 * The built bin's wiring: a command line that cannot be acted on must be
 * refused (exit 2) BEFORE the overlay is loaded, because loading it can run
 * `gh repo view`, and a typo in a flag should not cost a forge call or be
 * answered with an overlay complaint. A `gh` shim on PATH records every call.
 */
const BIN = resolve(import.meta.dirname, "../../dist/bins/fix-brief.js");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

beforeAll(() => {
  expect(existsSync(BIN), "run `yarn build` first").toBe(true);
});

function sandbox(config?: string) {
  const root = mkdtempSync(join(tmpdir(), "fix-brief-bin-"));
  dirs.push(root);
  expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
  if (config !== undefined) {
    mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
    writeFileSync(join(root, ".agents/orchestration/config.yaml"), config);
  }
  const shims = join(root, "shims");
  mkdirSync(shims);
  const log = join(root, "gh-calls.log");
  const gh = join(shims, "gh");
  writeFileSync(gh, `#!/bin/sh\necho "$@" >> "${log}"\nexit 1\n`);
  chmodSync(gh, 0o755);
  const run = (args: string[]) =>
    spawnSync(process.execPath, [BIN, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        HOME: root,
        PATH: [shims, dirname(process.execPath), "/usr/bin", "/bin"].join(
          delimiter,
        ),
      },
    });
  return { run, called: () => existsSync(log) };
}

describe("fix-brief bin — argv before config", () => {
  test("a bad command line exits 2 with the usage, and never calls gh", () => {
    const { run, called } = sandbox();
    const result = run(["--pr", "0"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: hexagen-orchestration-fix-brief");
    expect(called()).toBe(false);
  });

  test("a bad command line is not answered with an overlay complaint", () => {
    const { run } = sandbox("repo: acme/demo\nnope: 1\n");
    const result = run(["--pr", "0"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: hexagen-orchestration-fix-brief");
    expect(result.stderr).not.toContain("nope");
  });

  test("a good command line still reaches the overlay check", () => {
    const { run } = sandbox("repo: acme/demo\nnope: 1\n");
    const result = run([
      "--pr",
      "1",
      "--round",
      "1",
      "--lane",
      "L",
      "--worktree",
      "/w",
      "--branch",
      "b",
      "--tip",
      "abc1234",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nope");
  });
});
