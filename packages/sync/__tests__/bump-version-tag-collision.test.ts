import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error -- root script, plain ESM without a declaration file
import { assertTagIsFree } from "../../../scripts/bump-version.js";

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

  it("CLI: dry-run refuses a taken version before touching any file, and exits non-zero", () => {
    // v0.12.0 is real on origin (this repo's own release tag); no network mock needed.
    const r = spawnSync("node", [SCRIPT, "--set", "0.12.0", "--dry-run"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /already exists on origin/);
    assert.doesNotMatch(r.stdout, /Dry run complete/);
  });
});
