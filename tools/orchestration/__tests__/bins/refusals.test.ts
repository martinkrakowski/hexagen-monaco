import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The refuse-or-report contract, at the built bins.
 *
 * A bin that ACTS on a `loadConfigFor` result whose file is present and has
 * problems must exit 2, print every problem, and write nothing. Only `doctor`
 * prints the problems and keeps going. These run the real bins, because the
 * defect is in each bin's top-level wiring.
 */

const dist = (name: string): string =>
  resolve(import.meta.dirname, "../../dist/bins", `${name}.js`);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

beforeAll(() => {
  expect(existsSync(dist("plan-verify")), "run `yarn build` first").toBe(true);
});

/** A git repository with an empty plan directory and, optionally, a config. */
function repository(config: string | undefined): string {
  const root = mkdtempSync(join(tmpdir(), "orchestration-refuse-"));
  dirs.push(root);
  expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
  mkdirSync(join(root, "docs/planning"), { recursive: true });
  if (config !== undefined) {
    mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
    writeFileSync(join(root, ".agents/orchestration/config.yaml"), config);
  }
  return root;
}

const run = (name: string, cwd: string) =>
  spawnSync(process.execPath, [dist(name)], {
    cwd,
    encoding: "utf8",
    env: { HOME: cwd },
  });

describe("F13: plan-verify refuses an invalid overlay", () => {
  test("a present file with planDir set plus an unknown key exits 2, naming the key", () => {
    const root = repository(
      "repo: acme/demo\nplanDir: docs/planning\nnope: 1\n",
    );
    const result = run("plan-verify", root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nope");
    expect(result.stdout).toBe("");
  });

  test("an absent file still runs, with the defaults", () => {
    const result = run("plan-verify", repository(undefined));
    expect(result.status).toBe(0);
  });
});
