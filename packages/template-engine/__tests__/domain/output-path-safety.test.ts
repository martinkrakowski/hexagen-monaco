import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
// Tests may import `node:path`; domain must not. The table below holds
// `isContainedRelativePath` against the `path.posix` guard it replaced.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { isContainedRelativePath } from "../../src/domain/index.js";

/** The previous body, locked to posix so the oracle is platform-stable. */
function legacyIsContainedRelativePath(rel: string): boolean {
  if (path.posix.isAbsolute(rel)) return false;
  const normalized = path.posix.normalize(rel);
  return normalized !== ".." && !normalized.startsWith(`..${path.posix.sep}`);
}

describe("isContainedRelativePath", () => {
  const accepted = [
    "a.ts",
    "src/x.ts",
    "src/infrastructure/queue/index.ts",
    ".env.example",
    "a/../b.ts", // normalizes to b.ts — still contained
    "foo/./bar",
    "foo/.",
    "foo/",
    ".",
    "",
    "a/b/../c/../../d",
    "src//x.ts",
  ];

  const rejected = [
    "/etc/passwd",
    "../x",
    "../../x",
    "a/../../b", // normalizes to ../b
    "..",
    "foo/../../../bar",
    "//server/share",
    "./../escape.ts",
  ];

  it("accepts normal relative output paths", () => {
    for (const p of accepted) {
      assert.equal(isContainedRelativePath(p), true, p);
    }
  });

  it("rejects absolute paths and `..` traversal that escapes", () => {
    for (const p of rejected) {
      assert.equal(isContainedRelativePath(p), false, p);
    }
  });

  it("agrees with path.posix.isAbsolute + normalize for every pinned case", () => {
    for (const p of [...accepted, ...rejected]) {
      assert.equal(
        isContainedRelativePath(p),
        legacyIsContainedRelativePath(p),
        p,
      );
    }
  });

  it("rejects Windows separators and drive-absolutes that native path.join would honor", () => {
    // posix.normalize treats `..\..\outside.txt` as a single segment and
    // would accept it; FileSystemTemplateFileLoader then path.join's it.
    for (const p of [
      "..\\..\\outside.txt",
      "foo\\..\\..\\outside.txt",
      "C:\\Windows\\system.ini",
      "C:/Windows/system.ini",
    ]) {
      assert.equal(isContainedRelativePath(p), false, p);
    }
  });
});

describe("output-path-safety.ts — domain stays builtin-free", () => {
  it("imports no node: builtin", async () => {
    const url = new URL(
      "../../src/domain/output-path-safety.ts",
      import.meta.url,
    );
    const source = await readFile(url, "utf-8");
    const builtinImports = [
      ...source.matchAll(/from\s+["'](node:[^"']+)["']/g),
    ].map((m) => m[1]);
    expect(builtinImports).toEqual([]);
  });
});
