/**
 * Tag-collision check for the release bump — extracted so it is importable.
 *
 * This module deliberately carries NO shebang. `scripts/bump-version.js` is a
 * CLI and keeps its `#!/usr/bin/env node`, but a file with a shebang cannot be
 * imported by a vitest test on Windows: the transform pipeline leaves the `#!`
 * in place and Node reports `SyntaxError: Invalid or unexpected token` with no
 * stack, so the whole test file collects zero tests. Caught by the Windows leg
 * (#640); the sibling `scripts/locked-dependency-version.mjs` only escaped it
 * by accidentally omitting its shebang. Testable logic therefore lives here,
 * and `no-shebang-in-imported-scripts.guard.test.ts` keeps it that way.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Refuse a target whose `vX.Y.Z` tag already exists on origin.
 *
 * publish.yml triggers on a tag PUSH. On 2026-08-23 the 0.12.0 bump merged
 * cleanly, but `v0.12.0` had been pushed in May pointing at an unrelated
 * commit, so no publish ran, npm stayed at 0.11.0 and deploy.yml's npm
 * preflight blocked main until the stale tag was deleted by hand. Three
 * legacy tags have collided with the release line so far. Checking here --
 * before any file is written -- makes the collision a bump-time error
 * instead of a post-merge surprise.
 *
 * Fails closed: if origin cannot be queried, the bump stops and says so.
 * Throws (rather than exiting) so it is testable; the CLI call site turns
 * the throw into `fail()`. `remoteRefs` is injectable for the test cases.
 */
export function assertTagIsFree(target, remoteRefs = lsRemoteTags) {
  const tag = `v${target}`;
  const refs = remoteRefs();
  if (refs === null) {
    throw new Error(
      `Could not list tags on origin (git ls-remote failed); refusing to bump ` +
        `without knowing whether ${tag} is already taken.`,
    );
  }
  const hit = refs.find((r) => r.ref === `refs/tags/${tag}`);
  if (hit) {
    throw new Error(
      `Tag ${tag} already exists on origin at ${hit.sha.slice(0, 8)}. A tag push ` +
        `is what triggers publish.yml, and a second push of an existing tag ` +
        `triggers nothing. Delete it first if it is stale ` +
        `(git push origin :refs/tags/${tag}) or choose another version.`,
    );
  }
}

/** `[{ref, sha}]` for every tag on origin, or null when the remote cannot be read. */
function lsRemoteTags() {
  const r = spawnSync("git", ["ls-remote", "--tags", "origin"], {
    encoding: "utf8",
    cwd: ROOT, // the script may be invoked from anywhere; the repo's origin is what matters
  });
  if (r.status !== 0) return null;
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split("\t");
      return { sha, ref: ref.replace(/\^\{\}$/, "") };
    });
}
