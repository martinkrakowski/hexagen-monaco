import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { isOutputEnabled, outputPath } from "../../src/domain/output-gating.js";
import type { ManifestOutput } from "../../src/domain/index.js";

describe("isOutputEnabled", () => {
  it("always enables plain string outputs", () => {
    assert.equal(isOutputEnabled("a.ts", {}), true);
    assert.equal(isOutputEnabled("a.ts", { anything: false }), true);
  });

  it("equals matches a boolean answer", () => {
    const o: ManifestOutput = {
      path: "a.ts",
      when: { answer: "orm", equals: true },
    };
    assert.equal(isOutputEnabled(o, { orm: true }), true);
    assert.equal(isOutputEnabled(o, { orm: false }), false);
    assert.equal(isOutputEnabled(o, {}), false);
  });

  it("equals matches a select answer string", () => {
    const o: ManifestOutput = {
      path: "a.ts",
      when: { answer: "db", equals: "drizzle" },
    };
    assert.equal(isOutputEnabled(o, { db: "drizzle" }), true);
    assert.equal(isOutputEnabled(o, { db: "prisma" }), false);
  });

  it("includes tests multiselect membership", () => {
    const o: ManifestOutput = {
      path: "a.ts",
      when: { answer: "features", includes: "realtime" },
    };
    assert.equal(
      isOutputEnabled(o, { features: ["database", "realtime"] }),
      true,
    );
    assert.equal(isOutputEnabled(o, { features: ["database"] }), false);
    assert.equal(isOutputEnabled(o, {}), false);
  });

  it("tolerates a missing or corrupt answers map without throwing", () => {
    const o: ManifestOutput = {
      path: "a.ts",
      when: { answer: "orm", equals: true },
    };
    assert.equal(isOutputEnabled(o, undefined), false);
    assert.equal(isOutputEnabled(o, null), false);
    // a plain string output is always enabled regardless of answers
    assert.equal(isOutputEnabled("a.ts", undefined), true);
  });

  it("'in' matches when a scalar answer is one of the listed values", () => {
    const o: ManifestOutput = {
      path: "load.ts",
      when: { answer: "tool", in: ["dotenv", "dotenv-expand"] },
    };
    assert.equal(isOutputEnabled(o, { tool: "dotenv" }), true);
    assert.equal(isOutputEnabled(o, { tool: "dotenv-expand" }), true);
    assert.equal(isOutputEnabled(o, { tool: "none" }), false);
    assert.equal(isOutputEnabled(o, {}), false);
    // non-string answers never satisfy `in`
    assert.equal(isOutputEnabled(o, { tool: true }), false);
  });

  it("treats a bare answer condition as truthiness", () => {
    const o: ManifestOutput = { path: "a.ts", when: { answer: "x" } };
    assert.equal(isOutputEnabled(o, { x: true }), true);
    assert.equal(isOutputEnabled(o, { x: false }), false);
    assert.equal(isOutputEnabled(o, { x: ["v"] }), true);
    assert.equal(isOutputEnabled(o, { x: [] }), false);
    assert.equal(isOutputEnabled(o, { x: "s" }), true);
    assert.equal(isOutputEnabled(o, { x: "" }), false);
  });
});

describe("outputPath", () => {
  it("returns the string for a plain output", () => {
    assert.equal(outputPath("a.ts"), "a.ts");
  });
  it("returns .path for a gated output", () => {
    assert.equal(outputPath({ path: "b.ts", when: { answer: "x" } }), "b.ts");
  });
});
