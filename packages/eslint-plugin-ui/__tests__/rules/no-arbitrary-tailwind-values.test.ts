import assert from "node:assert/strict";
import { describe, it } from "node:test";
import rule from "../../src/rules/no-arbitrary-tailwind-values.js";

describe("no-arbitrary-tailwind-values", () => {
  it("exports a rule object with meta and create", () => {
    assert.ok(rule.meta);
    assert.ok(typeof rule.create === "function");
  });

  it("meta is configured with problem type", () => {
    assert.strictEqual(rule.meta.type, "problem");
  });
});
