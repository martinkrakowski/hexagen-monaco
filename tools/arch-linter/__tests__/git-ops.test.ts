import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveBaseRef } from "../src/git-ops.js";

describe("resolveBaseRef", () => {
  it("prefers an explicit --base-ref and prefixes a bare branch with origin/", () => {
    assert.equal(resolveBaseRef("main", {}), "origin/main");
    assert.equal(resolveBaseRef("origin/develop", {}), "origin/develop");
    assert.equal(resolveBaseRef(undefined, {}), null);
  });

  it("reads GITHUB_BASE_REF when no explicit ref is given", () => {
    assert.equal(
      resolveBaseRef(undefined, { GITHUB_BASE_REF: "main" }),
      "origin/main",
    );
  });
});
