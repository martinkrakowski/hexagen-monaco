import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error -- root script, plain ESM without a declaration file
import { assertTagIsFree } from "../../../scripts/lib/tag-collision.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SCRIPT = path.join(REPO_ROOT, "scripts/bump-version.js");

/**
 * publish.yml triggers on a tag PUSH. On 2026-08-23 `v0.12.0` already existed
 * on origin (pushed in May at an unrelated commit), so the merged bump
 * published nothing and deploy.yml's npm preflight blocked main. The bump
 * script now refuses a target whose tag exists, before writing any file.
 */
describe("scripts/bump-version.js — assertTagIsFree", () => {
  const refs =
    (...tags: string[]) =>
    () =>
      tags.map((t, i) => ({ sha: `${i}`.repeat(40), ref: `refs/tags/${t}` }));

  it("refuses a target whose tag exists on origin (the 2026-08-23 case)", () => {
    assert.throws(
      () => assertTagIsFree("0.12.0", refs("v0.11.0", "v0.12.0")),
      /v0\.12\.0 already exists on origin/,
    );
  });

  it("passes a free target", () => {
    assert.doesNotThrow(() =>
      assertTagIsFree("0.13.0", refs("v0.11.0", "v0.12.0")),
    );
  });

  it("does not confuse a prefix or a suffixed legacy tag with the target", () => {
    // v0.9.0-llm-assistant and v0.12.0-rc1 are not v0.9.0 / v0.12.0
    assert.doesNotThrow(() =>
      assertTagIsFree("0.9.0", refs("v0.9.0-llm-assistant")),
    );
    assert.doesNotThrow(() =>
      assertTagIsFree("0.12.0", refs("v0.12.0-rc1", "v0.12.01")),
    );
  });

  it("fails closed when origin cannot be listed", () => {
    assert.throws(
      () => assertTagIsFree("0.13.0", () => null),
      /Could not list tags on origin/,
    );
  });

  /**
   * Stand up a local bare repo holding `v0.12.0` and redirect `origin` to it
   * via git's environment-level url.<base>.insteadOf rewrite, so the CLI test
   * needs no network and cannot flake on connectivity (review flag on #635).
   * `outside` is a plain directory — not a repo, and with no `origin.git`
   * sibling, so git cannot DWIM-resolve `origin` from there: if ls-remote
   * ever loses its cwd pin, the query fails and the test fails.
   */
  function setupLocalOrigin(tmp: string): {
    env: NodeJS.ProcessEnv;
    outside: string;
  } {
    const seed = path.join(tmp, "seed");
    const bare = path.join(tmp, "origin.git");
    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync("git", args, { cwd, encoding: "utf8" });
      assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    fs.mkdirSync(seed);
    git(seed, "init", "-q");
    git(
      seed,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "seed",
    );
    git(seed, "tag", "v0.12.0");
    git(seed, "clone", "-q", "--bare", ".", bare);

    const realOrigin = git(REPO_ROOT, "remote", "get-url", "origin").trim();
    const env = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${bare}.insteadOf`,
      GIT_CONFIG_VALUE_0: realOrigin,
    };
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(outside);
    return { env, outside };
  }

  it("CLI: hermetic — refuses a version whose tag exists, passes a free one (local bare origin, no network)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bump-tag-"));
    try {
      const { env, outside } = setupLocalOrigin(tmp);

      const taken = spawnSync(
        "node",
        [SCRIPT, "--set", "0.12.0", "--dry-run"],
        {
          cwd: outside,
          encoding: "utf8",
          env,
        },
      );
      assert.notEqual(taken.status, 0);
      assert.match(taken.stderr + taken.stdout, /already exists on origin/);
      assert.doesNotMatch(taken.stdout, /Dry run complete/);

      const free = spawnSync("node", [SCRIPT, "--set", "9.9.9", "--dry-run"], {
        cwd: outside,
        encoding: "utf8",
        env,
      });
      assert.equal(free.status, 0, free.stderr);
      assert.match(free.stdout, /Dry run complete/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "CLI: runs (does not silently no-op) when invoked through a symlinked path",
    () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bump-link-"));
      try {
        const { env, outside } = setupLocalOrigin(tmp);
        const link = path.join(tmp, "bump-version.js");
        fs.symlinkSync(SCRIPT, link);

        const r = spawnSync("node", [link, "--set", "9.9.9", "--dry-run"], {
          cwd: outside,
          encoding: "utf8",
          env,
        });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /Dry run complete/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  );
});
