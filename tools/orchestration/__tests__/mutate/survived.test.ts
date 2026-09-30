import { beforeAll, afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * §7's `mutate` red case, on the real thing: "a mutation with no covering test
 * SURVIVES (exit 1) — demonstrated on a real fixture, not asserted".
 *
 * The command below exits 0 and never opens the mutated file, so nothing about
 * the mutation can be what turns the run green. That is the whole claim: an
 * uncovered mutation is reported, and the engine's exit code says so. Reading
 * the verdict off a mocked `execute` would assert the arithmetic; spawning the
 * BUILT bin is what proves the wiring around it — the entry point, the report,
 * and the exit code a caller actually reads.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const BIN = join(PACKAGE_ROOT, "dist/bins/mutate.js");

const ORIGINAL =
  "export function add(a: number, b: number) { return a + b; }\n";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function fixture(): { target: string; before: string; after: string } {
  const dir = mkdtempSync(join(tmpdir(), "mutate-survived-"));
  dirs.push(dir);
  const target = join(dir, "target.ts");
  const before = join(dir, "before.txt");
  const after = join(dir, "after.txt");
  writeFileSync(target, ORIGINAL);
  writeFileSync(before, "return a + b;");
  writeFileSync(after, "return a - b;");
  return { target, before, after };
}

beforeAll(() => {
  expect(existsSync(BIN), "run `yarn build` first").toBe(true);
});

describe("§7: a mutation no test covers SURVIVES", () => {
  test("the built bin exits 1 and says survived, and puts the file back", () => {
    const { target, before, after } = fixture();
    const result = spawnSync(
      process.execPath,
      [
        BIN,
        "--file",
        target,
        "--before",
        before,
        "--after",
        after,
        "--because",
        "the operator mutation has no covering test",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("verdict: survived");
    expect(result.stdout).toContain("exit code: 0");
    // A survived verdict is not a licence to leave the tree mutated.
    expect(readFileSync(target, "utf8")).toBe(ORIGINAL);
  });

  test("the same fixture is CAUGHT when a test does read the file and fails", () => {
    // The control: without it, "exits 1" could be the refusal of a fixture that
    // never mutated anything, which is a different failure wearing this shape.
    const { target, before, after } = fixture();
    const result = spawnSync(
      process.execPath,
      [
        BIN,
        "--file",
        target,
        "--before",
        before,
        "--after",
        after,
        "--because",
        "the operator mutation is covered",
        "--",
        process.execPath,
        "-e",
        'const fs = require("node:fs"); process.exit(fs.readFileSync(process.argv[1], "utf8").includes("return a - b;") ? 1 : 0);',
        target,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("verdict: caught");
    expect(readFileSync(target, "utf8")).toBe(ORIGINAL);
  });
});
