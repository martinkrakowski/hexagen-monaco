import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isContainedRelativePath } from "../../src/domain/index.js";

describe("isContainedRelativePath", () => {
  it("accepts normal relative output paths", () => {
    for (const p of [
      "a.ts",
      "src/x.ts",
      "src/infrastructure/queue/index.ts",
      ".env.example",
      "a/../b.ts", // normalizes to b.ts — still contained
    ]) {
      assert.equal(isContainedRelativePath(p), true, p);
    }
  });

  it("rejects absolute paths and `..` traversal that escapes", () => {
    for (const p of [
      "/etc/passwd",
      "../x",
      "../../x",
      "a/../../b", // normalizes to ../b
      "..",
    ]) {
      assert.equal(isContainedRelativePath(p), false, p);
    }
  });
});
