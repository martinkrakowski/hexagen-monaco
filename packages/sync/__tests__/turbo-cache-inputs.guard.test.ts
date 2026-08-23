import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    if (typeof entry !== "string" || !entry.startsWith(".")) return false;
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
   * Discovery of tsconfigs extending the repo-root base: `git grep` narrows
   * the candidates (tracked files only), then each candidate's `extends` is
   * resolved against its own directory so that non-root bases — the live
   * example is `config/tsconfig.json`, which extends a non-root
   * `./tsconfig.base.json` — do not inflate the count.
   *
   * `tsconfig.json` is JSONC in general; a file containing comments fails
   * JSON.parse and is excluded here — the guard then fails closed, which is
   * the safe direction, and the excluded file is named in the failure
   * message.
   */
  async function discoverRootBaseExtenders(): Promise<{
    matched: string[];
    extenders: string[];
  }> {
    let matched: string[] = [];
    try {
      matched = execFileSync(
        "git",
        ["grep", "-l", '"extends".*tsconfig.base', "--", "*/tsconfig.json"],
        { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      )
        .split("\n")
        .filter(Boolean);
    } catch (err) {
      const e = err as { status?: number; message: string };
      if (e.status !== 1) {
        // git grep exits 1 for "no matches" (an empty list is a legitimate
        // finding below); anything else — git missing, not a repo — means
        // discovery is unavailable. Fail with intent, not a raw stack.
        throw new Error(
          "extender discovery via `git grep` is unavailable " +
            `(${e.message}); cannot verify the tsconfig.base.json population floor`,
        );
      }
    }

    const extenders: string[] = [];
    for (const relPath of matched) {
      const absPath = path.join(REPO_ROOT, relPath);
      let config: unknown;
      try {
        config = JSON.parse(await fs.readFile(absPath, "utf8"));
      } catch {
        continue;
      }
      if (
        extendsRepoRootBase(absPath, (config as { extends?: unknown }).extends)
      ) {
        extenders.push(relPath);
      }
    }
    return { matched, extenders };
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
    const { matched, extenders } = await discoverRootBaseExtenders();
    const excluded = matched.filter((f) => !extenders.includes(f));
    assert.ok(
      extenders.length >= 20,
      `expected >=20 tsconfigs extending the repo-root tsconfig.base.json, ` +
        `found ${extenders.length}` +
        (excluded.length > 0
          ? ` (grep-matched but resolving elsewhere or unparsable: ` +
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
