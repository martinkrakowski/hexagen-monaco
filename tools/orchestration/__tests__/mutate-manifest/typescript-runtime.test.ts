import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * F18: `mutate-anchors` imports the TypeScript compiler API at RUN time.
 *
 * `src/mutate-manifest/lib/test-names.ts` reads a test's registered names off
 * its syntax, and `lib/anchors.ts` imports that module at the top level — so
 * `typescript` is a static import in this bin's graph, not a lazily reached
 * one. tsup keeps third-party modules external, which is right for a published
 * package and is exactly the shape that breaks when the dependency is declared
 * for the build but not for the consumer. Nothing that calls the library
 * functions can see this: the failure is module resolution inside a bundle, so
 * this test spawns the BUILT bin.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const BIN = join(PACKAGE_ROOT, "dist/bins/mutate-anchors.js");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "orchestration-ts-runtime-"));
  dirs.push(dir);
  return dir;
}

beforeAll(() => {
  expect(existsSync(BIN), "run `yarn build` first").toBe(true);
});

describe("F18: the compiler API resolves when the built bin loads", () => {
  test("mutate-anchors gets past module load with no compiler-API resolution error", () => {
    // A real git repository whose manifests directory is present but empty: the
    // bin must reach its own "nothing to check" answer and exit 0. A
    // `typescript` that could not be resolved dies before that, on stderr, as
    // ERR_MODULE_NOT_FOUND.
    const repo = tempDir();
    const init = spawnSync("git", ["init", "-q"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(init.status, init.stderr).toBe(0);
    mkdirSync(join(repo, ".agents/manifests"), { recursive: true });

    const result = spawnSync(process.execPath, [BIN], {
      cwd: repo,
      encoding: "utf8",
    });
    const out = `${result.stdout}${result.stderr}`;

    expect(out, out).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(out, out).not.toContain("Cannot find package 'typescript'");
    expect(result.status, out).toBe(0);
    expect(result.stdout).toContain(
      "no manifests in .agents/manifests; nothing to check",
    );
  });

  test("a repository with no manifests directory at all reaches its own refusal", () => {
    // The same module load, the other empty-state. An absent directory is a
    // directory that could not be listed, which the bin refuses rather than
    // reporting as "nothing to check" — so the exit is 2, and it is still not
    // ERR_MODULE_NOT_FOUND.
    const repo = tempDir();
    const init = spawnSync("git", ["init", "-q"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(init.status, init.stderr).toBe(0);

    const result = spawnSync(process.execPath, [BIN], {
      cwd: repo,
      encoding: "utf8",
    });
    const out = `${result.stdout}${result.stderr}`;

    expect(out, out).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(result.status, out).toBe(2);
    expect(result.stderr).toContain(
      "refusing to report that as nothing to check",
    );
  });

  test("the same bundle outside any node_modules tree fails, so the test above is not vacuous", () => {
    // The control. `typescript` is a bare specifier resolved from the module's
    // own location, so a copy of the bundle in a directory with no
    // `node_modules` above it cannot resolve it. Without this, "no
    // ERR_MODULE_NOT_FOUND" could be satisfied by a bundle that stopped
    // importing the compiler at all.
    const isolated = tempDir();
    copyFileSync(BIN, join(isolated, "mutate-anchors.js"));

    const env = { ...process.env };
    delete env.NODE_PATH;

    const result = spawnSync(
      process.execPath,
      [join(isolated, "mutate-anchors.js")],
      {
        cwd: isolated,
        encoding: "utf8",
        env,
      },
    );
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).not.toBe(0);
    expect(out, out).toContain("ERR_MODULE_NOT_FOUND");
    expect(out, out).toContain("typescript");
  });
});
