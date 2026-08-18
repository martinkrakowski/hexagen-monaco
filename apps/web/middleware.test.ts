import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { isProtectedPath } from "./middleware";

describe("auth middleware path gate", () => {
  it("protects account and billing only — generate APIs stay open", () => {
    assert.equal(isProtectedPath("/account"), true);
    assert.equal(isProtectedPath("/billing"), true);
    assert.equal(isProtectedPath("/billing/checkout"), true);
    assert.equal(isProtectedPath("/projects"), false);
    assert.equal(isProtectedPath("/api/manifest/generate"), false);
    assert.equal(isProtectedPath("/api/manifest/generate/stage"), false);
    assert.equal(isProtectedPath("/auth/signin"), false);
  });
});
