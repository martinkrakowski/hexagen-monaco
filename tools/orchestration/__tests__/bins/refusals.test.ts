import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
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
    const root = repository(undefined);
    const result = spawnSync(process.execPath, [dist("plan-verify")], {
      cwd: root,
      encoding: "utf8",
      // The artifact's default location is per-repository and this temp repo
      // has no name, so the documented override supplies one.
      env: { HOME: root, PLAN_VERIFY_ARTIFACT: join(root, "pv.json") },
    });
    expect(result.status).toBe(0);
  });

  test("with no repo and no override the artifact location is refused, not defaulted to a shared root", () => {
    const result = run("plan-verify", repository(undefined));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no repository name");
  });
});

describe("F14: init refuses to scaffold from an invalid overlay", () => {
  test("a present config.yaml with an unknown key exits 2 and every file is byte-identical", () => {
    const original = "repo: acme/demo\nnope: 1\n";
    const root = repository(original);
    const overlay = join(root, ".agents/orchestration");
    const before = readdirSync(overlay);
    const result = run("init", root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nope");
    expect(readdirSync(overlay)).toEqual(before);
    expect(readFileSync(join(overlay, "config.yaml"), "utf8")).toBe(original);
  });

  test("an absent overlay is still scaffolded", () => {
    const root = repository(undefined);
    const result = run("init", root);
    expect(result.status).toBe(0);
    expect(existsSync(join(root, ".agents/orchestration/house-rules.md"))).toBe(
      true,
    );
  });
});

describe("a directory is not a file", () => {
  test("doctor: a directory at .github/workflows/ci.yml fails the ci.yml check", () => {
    const root = repository("repo: acme/demo\n");
    mkdirSync(join(root, ".github/workflows/ci.yml"), { recursive: true });
    const result = run("doctor", root);
    expect(`${result.stdout}${result.stderr}`).toContain(
      ".github/workflows/ci.yml is missing",
    );
    expect(result.status).toBe(1);
  });

  test("init: a directory at a scaffold file path is reported, and nothing is written", () => {
    const root = repository("repo: acme/demo\n");
    const overlay = join(root, ".agents/orchestration");
    mkdirSync(join(overlay, "lessons.md"));
    const before = readdirSync(overlay).sort();
    const result = run("init", root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("lessons.md");
    expect(result.stderr).toContain("not a regular file");
    expect(readdirSync(overlay).sort()).toEqual(before);
  });
});
