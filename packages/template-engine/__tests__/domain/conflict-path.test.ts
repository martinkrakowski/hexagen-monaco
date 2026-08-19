import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
// Tests may import `node:path`; domain must not. The table below holds
// `conflictFilePath` against the `path.posix.extname` rewrite it replaced.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { conflictFilePath } from "../../src/domain/index.js";

/** The previous body of `conflictFilePath`, using posix so CI and Windows agree. */
function legacyConflictFilePath(filePath: string): string {
  const ext = path.posix.extname(filePath);
  return ext
    ? filePath.slice(0, -ext.length) + ".hexagen-update" + ext
    : filePath + ".hexagen-update";
}

describe("conflictFilePath", () => {
  const cases = [
    ["rate-limit.ts", "rate-limit.hexagen-update.ts"],
    ["package.json", "package.hexagen-update.json"],
    ["Dockerfile", "Dockerfile.hexagen-update"],
    [".env", ".env.hexagen-update"],
    [".env.example", ".env.hexagen-update.example"],
    ["src/a.ts", "src/a.hexagen-update.ts"],
    ["src/nested/deep/file.tsx", "src/nested/deep/file.hexagen-update.tsx"],
    ["config/.eslintrc.json", "config/.eslintrc.hexagen-update.json"],
    [
      "app/api/auth/[...all]/route.ts",
      "app/api/auth/[...all]/route.hexagen-update.ts",
    ],
    ["scripts/build.config.mjs", "scripts/build.config.hexagen-update.mjs"],
    ["index.coffee.md", "index.coffee.hexagen-update.md"],
    ["index.", "index.hexagen-update."],
    [".file.ts", ".file.hexagen-update.ts"],
    ["..file", "..hexagen-update.file"],
  ] as const;

  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(conflictFilePath(input), expected);
      assert.equal(conflictFilePath(input), legacyConflictFilePath(input));
    });
  }

  it("agrees with path.posix.extname on trailing-separator quirks", () => {
    // Same slice-from-end as the node:path body — trailing `/` is not stripped
    // from the prefix, so `file.ts/` becomes `file..hexagen-update.ts`.
    assert.equal(
      conflictFilePath("file.ts/"),
      legacyConflictFilePath("file.ts/"),
    );
    assert.equal(
      conflictFilePath("file.ts///"),
      legacyConflictFilePath("file.ts///"),
    );
  });
});

describe("conflict-path.ts — domain stays builtin-free", () => {
  it("imports no node: builtin", async () => {
    const url = new URL("../../src/domain/conflict-path.ts", import.meta.url);
    const source = await readFile(url, "utf-8");
    const builtinImports = [
      ...source.matchAll(/from\s+["'](node:[^"']+)["']/g),
    ].map((m) => m[1]);
    expect(builtinImports).toEqual([]);
  });
});
