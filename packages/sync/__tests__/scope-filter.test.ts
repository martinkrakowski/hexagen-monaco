import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchesScope } from "../src/scope-filter.js";

describe("matchesScope", () => {
  describe("plain path / directory prefix", () => {
    it("matches the directory itself and everything beneath it", () => {
      assert.equal(matchesScope("packages/shared", ["packages/shared"]), true);
      assert.equal(
        matchesScope("packages/shared/src/index.ts", ["packages/shared"]),
        true,
      );
    });

    it("does not match a sibling whose name shares a prefix", () => {
      // "packages/shared-utils" must NOT match scope "packages/shared".
      assert.equal(
        matchesScope("packages/shared-utils/src/x.ts", ["packages/shared"]),
        false,
      );
    });

    it("treats a trailing slash as equivalent", () => {
      assert.equal(
        matchesScope("packages/shared/src/x.ts", ["packages/shared/"]),
        true,
      );
    });

    it("matches an exact file path", () => {
      assert.equal(matchesScope("turbo.json", ["turbo.json"]), true);
      assert.equal(matchesScope("turbo.json", ["package.json"]), false);
    });
  });

  describe("glob patterns", () => {
    it("`*` stays within a single path segment", () => {
      assert.equal(
        matchesScope("packages/shared/tsconfig.json", [
          "packages/*/tsconfig.json",
        ]),
        true,
      );
      // `*` must not cross a slash — nested tsconfig is out of scope.
      assert.equal(
        matchesScope("packages/shared/src/tsconfig.json", [
          "packages/*/tsconfig.json",
        ]),
        false,
      );
    });

    it("`**` crosses directory separators", () => {
      assert.equal(
        matchesScope("packages/a/src/deep/index.ts", ["packages/**/index.ts"]),
        true,
      );
      assert.equal(
        matchesScope("packages/a/index.ts", ["packages/**/index.ts"]),
        true,
      );
    });

    it("`?` matches exactly one non-separator character", () => {
      assert.equal(matchesScope("a/b.ts", ["a/?.ts"]), true);
      assert.equal(matchesScope("a/bc.ts", ["a/?.ts"]), false);
    });
  });

  describe("multiple patterns", () => {
    it("is in scope if ANY pattern matches", () => {
      const patterns = ["packages/shared", "apps/web"];
      assert.equal(matchesScope("apps/web/page.tsx", patterns), true);
      assert.equal(matchesScope("packages/shared/x.ts", patterns), true);
      assert.equal(matchesScope("packages/other/x.ts", patterns), false);
    });
  });

  describe("edge cases", () => {
    it("an empty pattern list fails closed (matches nothing)", () => {
      assert.equal(matchesScope("packages/shared/x.ts", []), false);
    });

    it("ignores leading ./ on both sides", () => {
      assert.equal(
        matchesScope("./packages/shared/x.ts", ["./packages/shared"]),
        true,
      );
    });

    it("normalizes backslashes (Windows-style paths)", () => {
      assert.equal(
        matchesScope("packages\\shared\\x.ts", ["packages/shared"]),
        true,
      );
    });
  });
});
