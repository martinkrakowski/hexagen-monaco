import { describe, it } from "vitest";
import assert from "node:assert/strict";
// `node:path` is banned in domain/application (arch-linter `node-builtin-in-layer`)
// but not in tests — and here it is the point: the table below asserts the pure
// segment arithmetic agrees with the `path.join` + `path.relative` guard it
// replaced, key for key.
import path from "node:path";
import { toWorkspaceSegments } from "../../src/domain/workspace-path.js";

const ROOT = "/tmp/hexagen-1700000000000-abc123";

/**
 * The exact guard `GenerateProjectUseCase.mergeAddOnFilesIntoTempDir` ran
 * before HEX-002, reproduced verbatim so the new domain function can be held
 * against it. Returns the destination path, or null where the old code threw.
 */
function legacyGuard(rel: string): string | null {
  const dest = path.join(ROOT, rel);
  const within = path.relative(ROOT, dest);
  if (
    within === ".." ||
    within.startsWith(".." + path.sep) ||
    path.isAbsolute(within)
  ) {
    return null;
  }
  return dest;
}

describe("toWorkspaceSegments", () => {
  const accepted = [
    "README.md",
    "src/feature.ts",
    "src/nested/deep/feature.ts",
    ".github/workflows/sync-integrity.yml",
    "HEXAGEN-ADDON-NOTICES.md",
    "project.zip",
    "./src/feature.ts",
    "src//feature.ts",
    "src/./feature.ts",
    "src/sub/../feature.ts",
    // `path.join(root, "/etc/passwd")` absorbs the leading slash and lands
    // INSIDE the root — preserved deliberately rather than "fixed" here.
    "/etc/passwd",
  ];

  for (const key of accepted) {
    it(`accepts ${JSON.stringify(key)} and agrees with the legacy path guard`, () => {
      const segments = toWorkspaceSegments(key);
      assert.notEqual(segments, null, "expected the key to be accepted");
      const legacy = legacyGuard(key);
      assert.notEqual(legacy, null, "legacy guard should also accept it");
      assert.equal(
        path.join(ROOT, ...(segments ?? [])),
        legacy,
        "segment arithmetic must resolve to the same destination as path.join",
      );
    });
  }

  const rejected = [
    "../escape.ts",
    "../../escape.ts",
    "src/../../escape.ts",
    "..",
    "./../escape.ts",
  ];

  for (const key of rejected) {
    it(`rejects ${JSON.stringify(key)}`, () => {
      assert.equal(toWorkspaceSegments(key), null);
    });
  }

  it("rejects a key that normalizes to the root itself (no file to write)", () => {
    // The legacy guard let these through and then failed with EISDIR at
    // `writeFile`; rejecting up front is the same outcome (a throw) with a
    // message that names the offending key.
    assert.equal(toWorkspaceSegments(""), null);
    assert.equal(toWorkspaceSegments("."), null);
    assert.equal(toWorkspaceSegments("src/.."), null);
  });

  it("rejects backslash-bearing segments instead of guessing a separator", () => {
    // Emitter keys are posix. A `\` could be a legal posix filename or a
    // Windows traversal; refusing to guess closes the traversal hole without
    // reinterpreting a name.
    assert.equal(toWorkspaceSegments("src\\..\\..\\escape.ts"), null);
    assert.equal(toWorkspaceSegments("a\\b"), null);
  });

  it("rejects a trailing separator, which the legacy guard also refused to write", () => {
    // `path.join(root, "src/feature.ts/")` preserves the trailing slash, and the
    // subsequent `writeFile` failed with EISDIR/ENOTDIR — so the old behaviour
    // for such a key was "throw", and rejecting it here keeps that. Normalizing
    // it to `src/feature.ts` instead would be the one behaviour change in this
    // refactor, and the wrong direction: a directory-shaped key is a malformed
    // emitter key, and turning it into a successful write to a neighbouring
    // path hides the bug. Same call as the `\` rule — refuse, don't guess.
    assert.equal(
      path.join(ROOT, "src/feature.ts/"),
      `${ROOT}/src/feature.ts/`,
      "legacy behaviour, for the record: the slash survives the join",
    );
    assert.equal(toWorkspaceSegments("src/feature.ts/"), null);
    assert.equal(toWorkspaceSegments("src/"), null);
    assert.equal(toWorkspaceSegments("/"), null);

    // Only a TRAILING separator is malformed — interior duplicates still
    // collapse exactly as `path.join` collapses them.
    assert.deepEqual(toWorkspaceSegments("src//feature.ts"), [
      "src",
      "feature.ts",
    ]);
  });

  it("returns segments, not a joined path — the port never sees path syntax", () => {
    assert.deepEqual(toWorkspaceSegments("src/nested/feature.ts"), [
      "src",
      "nested",
      "feature.ts",
    ]);
  });
});
