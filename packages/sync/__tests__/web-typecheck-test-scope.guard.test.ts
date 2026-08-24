import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-wide guard: `apps/web`'s `typecheck:test` must actually see the test
 * files it claims to check.
 *
 * Why this exists. `apps/web/tsconfig.json` excludes `**\/*.test.ts(x)` so the
 * Next build never compiles tests. `tsconfig.test.json` `extends` it, and
 * `extends` inherits `exclude` — so until enforcement-plan packet P2.1 the test
 * config saw **zero** of the 231 test files and `tsc -p tsconfig.test.json`
 * reported success while checking nothing (the catalogue's master pattern,
 * AUD-010). The first honest run surfaced 143 type errors across 45 files.
 *
 * The fix is one `exclude` override in `tsconfig.test.json`. Nothing else
 * would notice if a future edit restored the inherited exclude, renamed the
 * test glob, or added a directory the include misses: the script would go
 * green again and stay green. This guard pins the count.
 *
 * Scope note: this asserts that every `*.test.ts(x)` under `apps/web` is in
 * the program `tsconfig.test.json` describes. Whether those files type-check
 * is `typecheck:test`'s job; whether they run is vitest's. One failure, one
 * cause.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const WEB = path.join(REPO_ROOT, "apps", "web");
const TEST_FILE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "dist"]);

async function findTestFiles(
  dir: string,
  out: string[] = [],
): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await findTestFiles(path.join(dir, entry.name), out);
    } else if (TEST_FILE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function programFiles(): Set<string> {
  // `tsc --listFilesOnly` prints the resolved program without type-checking it,
  // so this stays cheap and independent of whether the tests currently pass.
  const tscBin = path.join(
    REPO_ROOT,
    "node_modules",
    "typescript",
    "bin",
    "tsc",
  );
  const output = execFileSync(
    process.execPath,
    [tscBin, "--listFilesOnly", "-p", path.join(WEB, "tsconfig.test.json")],
    { cwd: WEB, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return new Set(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => path.resolve(file)),
  );
}

describe("apps/web typecheck:test scope (enforcement plan P2.1)", () => {
  it("tsconfig.test.json includes every *.test.ts(x) under apps/web", async () => {
    const onDisk = (await findTestFiles(WEB)).map((file) => path.resolve(file));
    // A guard over an empty population proves nothing. 231 at the time of
    // writing; a drop to zero means the walk broke, not that tests vanished.
    assert.ok(
      onDisk.length > 100,
      `expected >100 test files, found ${onDisk.length}`,
    );

    const inProgram = programFiles();
    const missing = onDisk.filter((file) => !inProgram.has(file));
    assert.deepEqual(
      missing.map((file) => path.relative(REPO_ROOT, file)).sort(),
      [],
      `${missing.length} of ${onDisk.length} apps/web test files are not in the ` +
        "tsconfig.test.json program -- typecheck:test would report success " +
        "without checking them. Fix tsconfig.test.json's exclude/include.",
    );
  });
});
