import { describe, it, afterAll } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * A path in TypeScript's own convention: forward slashes on every platform.
 *
 * Two win32 defects in this file shared one cause — native separators leaking
 * into places that require TS/JSON conventions. `ts.parseConfigFileTextToJson`
 * asserts its file name is already normalised (a backslashed name trips
 * `Debug Failure. Expected C:/... === C:\...`), and a `path.relative()` result
 * embedded in a JSON string makes `"..\..\tsconfig.base.json"` — invalid JSON
 * escapes, so `extends` silently failed to resolve. tsconfig `extends` uses
 * forward slashes on every platform, so this is also the correct output.
 *
 * Exported for the unit test below, which feeds it a win32 path on any host.
 */
export function toTsPath(p: string): string {
  return p.replace(/\\/g, "/");
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ROOT_BASE = path.join(REPO_ROOT, "tsconfig.base.json");

/**
 * Turbo cache-key correctness (enforcement plan P3.2, decision D-2).
 *
 * The stale-`dist` defects in the learnings catalogue (#616 subprocess dist,
 * #465 lint never reaching arch-linter, #452 bin shim) were all MISSING
 * EDGES: a task consumed a file that was not in its cache key, so a cached
 * "success" replayed against inputs that had changed. The 2026-08-23 audit
 * found one live instance: `tsconfig.base.json` is extended by every
 * workspace tsconfig but was in no task's hash — editing it left every
 * cached `build`/`typecheck` result replayable (verified: identical task
 * hash before/after an edit). The fix and the other audited edges are pinned
 * here so they cannot silently regress.
 *
 * What this guard CANNOT catch, stated plainly: a NEW run-time consumption
 * edge (a script shelling out to another package's dist) that nobody
 * declares anywhere. Turbo's config cannot express "what a subprocess
 * reads"; this file pins the edges the audit found and the structural rules
 * turbo does honour. Also note: the per-task `inputs` lists on `cache: false`
 * tasks (`test`, `typecheck:test`) are inert — turbo never replays those
 * tasks, so their inputs affect nothing; they are left in place as
 * documentation only.
 */

/**
 * True when one of a tsconfig's `extends` entries is a relative path that
 * resolves to the repo-root tsconfig.base.json. `extends` may be a string or
 * (TS 5.0+) an array; bare package specifiers (e.g.
 * "@tsconfig/node20/tsconfig.json") never resolve to the repo-root base via a
 * file path, so only "./"- or "../"-prefixed entries are considered. The
 * repo's stable workspace shape is `"../../tsconfig.base.json"` from every
 * directory under `packages` and `apps`.
 */
function extendsRepoRootBase(
  tsconfigAbsPath: string,
  extendsValue: unknown,
): boolean {
  const entries = Array.isArray(extendsValue) ? extendsValue : [extendsValue];
  return entries.some((entry) => {
    if (typeof entry !== "string") return false;
    // Relative ("./", "../") or absolute entries are file paths and are
    // resolved; a bare package specifier ("@tsconfig/strictest/tsconfig.json")
    // never denotes the repo-root base and is excluded. Absolute must be
    // accepted: on the Windows runners TEMP is on C: and the workspace on D:,
    // and `path.relative` across drives returns an ABSOLUTE path, so a fixture
    // that legitimately points at the base was silently read as "not an
    // extender" — the two counting tests reported false rather than failing.
    if (!entry.startsWith(".") && !path.isAbsolute(entry)) return false;
    return path.resolve(path.dirname(tsconfigAbsPath), entry) === ROOT_BASE;
  });
}

describe("turbo.json cache-input guard (P3.2)", () => {
  async function loadTurbo(): Promise<{
    globalDependencies: string[];
    pipeline: Record<
      string,
      { dependsOn?: string[]; inputs?: string[]; cache?: boolean }
    >;
  }> {
    const raw = await fs.readFile(path.join(REPO_ROOT, "turbo.json"), "utf8");
    return JSON.parse(raw);
  }

  /**
   * Discovery of tsconfigs extending the repo-root base: every TRACKED
   * tsconfig.json is enumerated (`git ls-files`, content-agnostic — no line
   * pattern can miss a legal syntax form such as a multiline TS 5+ `extends`
   * array), then each file's `extends` is resolved against its own directory
   * so that non-root bases — the live example is `config/tsconfig.json`,
   * which extends a non-root `./tsconfig.base.json` — do not inflate the
   * count. Files whose `extends` resolves elsewhere, or that have no
   * `extends` at all, are legitimately excluded and named in the failure
   * message.
   *
   * tsconfig.json is JSONC in general: parsing uses TypeScript's own
   * `parseConfigFileTextToJson`, so legal comments and trailing commas still
   * count. A tracked file that not even the JSONC parser accepts FAILS the
   * guard loudly (fail-closed) — a skipped candidate is an invisible one,
   * and the floor must not pass over an unreadable file.
   */
  function listTrackedTsconfigs(): string[] {
    try {
      return execFileSync("git", ["ls-files", "--", "*/tsconfig.json"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      })
        .split("\n")
        .filter(Boolean);
    } catch (err) {
      const e = err as { message: string };
      // `git ls-files` exits 0 even with no matches, so any throw — git
      // missing, not a repo — means discovery is unavailable. Fail with
      // intent, not a raw stack.
      throw new Error(
        "extender discovery via `git ls-files` is unavailable " +
          `(${e.message}); cannot verify the tsconfig.base.json population floor`,
      );
    }
  }

  function parseTsconfigText(fileName: string, text: string): unknown {
    // TypeScript's API speaks its own path convention — forward slashes on
    // every platform — and asserts the name it is handed is already
    // normalised. `path.join` yields backslashes on win32, which tripped
    // an internal `Debug Failure. Expected C:/... === C:\...` and made the
    // guard fail for a reason that had nothing to do with tsconfigs. Caught
    // by the Windows leg (#640) on its first run against another PR's diff;
    // the catalogue's §2.3 separator class, in a test that shipped green on
    // ubuntu.
    const tsFileName = toTsPath(fileName);
    const { config, error } = ts.parseConfigFileTextToJson(tsFileName, text);
    if (error !== undefined || config === undefined) {
      const detail =
        typeof error?.messageText === "string"
          ? error.messageText
          : "no config object parsed";
      throw new Error(
        `tracked tsconfig ${fileName} is unparseable even as JSONC ` +
          `(${detail}); the population floor cannot be verified over an ` +
          `unreadable candidate — fix or remove the file`,
      );
    }
    return config;
  }

  async function isRootBaseExtender(tsconfigAbsPath: string): Promise<boolean> {
    const text = await fs.readFile(tsconfigAbsPath, "utf8");
    const config = parseTsconfigText(tsconfigAbsPath, text) as {
      extends?: unknown;
    };
    return extendsRepoRootBase(tsconfigAbsPath, config.extends);
  }

  async function discoverRootBaseExtenders(): Promise<{
    tracked: string[];
    extenders: string[];
  }> {
    const tracked = listTrackedTsconfigs();
    const extenders: string[] = [];
    for (const relPath of tracked) {
      if (await isRootBaseExtender(path.join(REPO_ROOT, relPath))) {
        extenders.push(relPath);
      }
    }
    return { tracked, extenders };
  }

  it("pipeline discovery is non-empty (the guard is checking something)", async () => {
    const turbo = await loadTurbo();
    const tasks = Object.keys(turbo.pipeline);
    assert.ok(
      tasks.length >= 6,
      `expected the pipeline to define at least 6 tasks, found ${tasks.length}`,
    );
    assert.ok(
      turbo.globalDependencies.length > 0,
      "globalDependencies is empty; the base-config edge below cannot hold",
    );
  });

  it("tsconfig.base.json is in the global hash, and the reason still exists", async () => {
    const turbo = await loadTurbo();
    assert.ok(
      turbo.globalDependencies.includes("tsconfig.base.json"),
      "tsconfig.base.json missing from globalDependencies: editing the base " +
        "config would leave every cached build/typecheck replayable " +
        "(2026-08-23 audit; verified stale-hash before the fix)",
    );

    // Population floor: the pin must not outlive its reason. If the repo
    // stops extending the base config, this guard should be revisited, not
    // silently satisfied. Only tsconfigs whose `extends` resolves to the
    // REPO-ROOT tsconfig.base.json count toward the floor.
    const { tracked, extenders } = await discoverRootBaseExtenders();
    const excluded = tracked.filter((f) => !extenders.includes(f));
    assert.ok(
      extenders.length >= 20,
      `expected >=20 tsconfigs extending the repo-root tsconfig.base.json, ` +
        `found ${extenders.length}` +
        (excluded.length > 0
          ? ` (tracked tsconfig.json files not extending the root base: ` +
            `${excluded.slice(0, 5).join(", ")})`
          : ""),
    );
  });

  it("extender resolution counts only extends that resolve to the repo-root base", () => {
    // The config/ trap: a same-named base beside the tsconfig must not count.
    assert.equal(
      extendsRepoRootBase(
        path.join(REPO_ROOT, "config/tsconfig.json"),
        "./tsconfig.base.json",
      ),
      false,
    );
    // The stable workspace shape.
    assert.equal(
      extendsRepoRootBase(
        path.join(REPO_ROOT, "packages/sync/tsconfig.json"),
        "../../tsconfig.base.json",
      ),
      true,
    );
    // TS 5.0+ array form counts when any entry resolves to the root base.
    assert.equal(
      extendsRepoRootBase(path.join(REPO_ROOT, "packages/sync/tsconfig.json"), [
        "@tsconfig/strictest/tsconfig.json",
        "../../tsconfig.base.json",
      ]),
      true,
    );
    // Bare package specifiers never resolve to the repo-root base.
    assert.equal(
      extendsRepoRootBase(
        path.join(REPO_ROOT, "packages/sync/tsconfig.json"),
        "@tsconfig/node20/tsconfig.json",
      ),
      false,
    );
    // No extends at all.
    assert.equal(
      extendsRepoRootBase(
        path.join(REPO_ROOT, "packages/sync/tsconfig.json"),
        undefined,
      ),
      false,
    );
  });

  /**
   * Fixtures for the two discovery blind spots found in PR #639 review
   * (CodeRabbit): a legal multiline TS 5+ `extends` array, and legal JSONC
   * (comments / trailing commas). Both were invisible to the previous
   * grep+JSON.parse pipeline — reproduced by staging the fixtures and
   * observing the floor still pass at 33 — so both must now count. Each
   * fixture's `extends` is computed to resolve to the repo-root base from
   * wherever the temp directory lands.
   */
  const fixtureDirs: string[] = [];

  async function writeFixture(
    renderExtends: (dir: string) => string,
  ): Promise<string> {
    // os.tmpdir(), never inside the repo: an in-repo fixture races the other
    // guards that scan tracked tsconfigs while vitest runs files in parallel.
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-turbo-guard-"),
    );
    fixtureDirs.push(dir);
    const absPath = path.join(dir, "tsconfig.json");
    await fs.writeFile(absPath, renderExtends(dir), "utf8");
    return absPath;
  }

  // In-repo fixtures must not survive the run (os.tmpdir() used to clean up
  // for us). Removed even when a test fails.
  afterAll(async () => {
    await Promise.all(
      fixtureDirs.map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  it("discovery counts a legal multiline TS 5+ extends array", async () => {
    const absPath = await writeFixture(
      (dir) =>
        `{\n  "extends": [\n    "@tsconfig/strictest/tsconfig.json",\n    "${toTsPath(path.relative(dir, ROOT_BASE))}"\n  ],\n  "compilerOptions": {}\n}\n`,
    );
    assert.equal(await isRootBaseExtender(absPath), true);
  });

  it("discovery counts a legal JSONC extender (comment, trailing comma)", async () => {
    const absPath = await writeFixture(
      (dir) =>
        `{\n  // legal tsconfig comment\n  "extends": "${toTsPath(path.relative(dir, ROOT_BASE))}",\n}\n`,
    );
    assert.equal(await isRootBaseExtender(absPath), true);
  });

  it("discovery counts an ABSOLUTE extends that resolves to the base (the cross-drive case)", async () => {
    // On the Windows runners TEMP and the workspace are on different drives,
    // so `path.relative` returns an absolute path. Reproduced here on any
    // platform by writing the absolute path directly.
    const absPath = await writeFixture(
      () => `{\n  "extends": "${toTsPath(ROOT_BASE)}"\n}\n`,
    );
    assert.equal(await isRootBaseExtender(absPath), true);
  });

  it("discovery still rejects a bare package specifier", async () => {
    const absPath = await writeFixture(
      () => `{\n  "extends": "@tsconfig/strictest/tsconfig.json"\n}\n`,
    );
    assert.equal(await isRootBaseExtender(absPath), false);
  });

  it("toTsPath converts win32 separators — the fault the Windows leg caught", () => {
    // Platform-independent: the input is a literal win32 path, so this runs
    // the same on ubuntu. Both prior failures came from native separators
    // reaching a consumer that requires forward slashes — the TS config
    // parser (Debug Failure) and a JSON string literal (invalid escapes).
    assert.equal(
      toTsPath("C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\x\\tsconfig.json"),
      "C:/Users/RUNNER~1/AppData/Local/Temp/x/tsconfig.json",
    );
    assert.equal(
      toTsPath("..\\..\\tsconfig.base.json"),
      "../../tsconfig.base.json",
    );
    // A JSON string built from the result must not carry stray escapes.
    assert.deepEqual(
      JSON.parse(`{"extends": "${toTsPath("..\\..\\tsconfig.base.json")}"}`),
      { extends: "../../tsconfig.base.json" },
    );
    // Already-posix input is untouched.
    assert.equal(
      toTsPath("../../tsconfig.base.json"),
      "../../tsconfig.base.json",
    );
  });

  it("an unparseable tracked tsconfig fails the guard loudly instead of being skipped", async () => {
    const absPath = await writeFixture(() => "not json at all {[");
    await assert.rejects(isRootBaseExtender(absPath), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /unparseable even as JSONC/);
      assert.ok(err.message.includes(absPath));
      return true;
    });
  });

  it("tsconfig enumeration is content-agnostic (no-extends files are still listed)", () => {
    // The old `git grep '"extends".*tsconfig.base'` pre-filter could only
    // ever see files whose extends sat on one line; enumeration by filename
    // cannot miss a legal syntax form. These tracked files have no `extends`
    // at all and must still be listed.
    const tracked = listTrackedTsconfigs();
    assert.ok(
      tracked.includes("tools/arch-linter/tsconfig.json") &&
        tracked.includes(
          "tools/arch-linter/__tests__/external-repo/tsconfig.json",
        ) &&
        tracked.includes("packages/eslint-plugin-ui/tsconfig.json"),
      `expected content-agnostic enumeration to list no-extends tsconfigs, got: ${tracked.length} files`,
    );
  });

  it("globalDependencies carries file globs, not environment-variable names", async () => {
    const turbo = await loadTurbo();
    const envShaped = turbo.globalDependencies.filter((entry) =>
      /^[A-Z][A-Z0-9_]*$/.test(entry),
    );
    assert.deepEqual(
      envShaped,
      [],
      `these entries look like env-var names and match no file, so they ` +
        `contribute nothing to the hash — declare them in globalEnv instead: ` +
        `${envShaped.join(", ")} (the NODE_ENV case, removed 2026-08-23)`,
    );
  });

  it("every compile-consuming task declares the ^build edge", async () => {
    const turbo = await loadTurbo();
    for (const task of [
      "build",
      "lint",
      "test",
      "typecheck",
      "typecheck:test",
    ]) {
      const dependsOn = turbo.pipeline[task]?.dependsOn ?? [];
      assert.ok(
        dependsOn.includes("^build"),
        `${task} lost its ^build edge — its package consumes workspace ` +
          `dependencies' dist (typecheck:test: #267 / TS6305)`,
      );
    }
  });

  it("sync's tests keep the run-time binary edge to the built arch-linter", async () => {
    const turbo = await loadTurbo();
    const dependsOn = turbo.pipeline["@hexagen/sync#test"]?.dependsOn ?? [];
    assert.ok(
      dependsOn.includes("@hexagen/arch-linter#build"),
      "@hexagen/sync#test no longer depends on @hexagen/arch-linter#build: " +
        "its contract tests spawn the BUILT linter binary (a run-time edge " +
        "package.json imports do not express)",
    );
    assert.ok(
      dependsOn.includes("build"),
      "@hexagen/sync#test must depend on its own build: the contract tests " +
        "run packages/sync/dist/cli.js",
    );
  });
});
