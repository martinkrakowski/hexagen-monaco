import assert from "node:assert/strict";
import { describe, it } from "vitest";
import rule from "../../src/rules/no-arbitrary-tailwind-values.js";

import type { TSESLint } from "@typescript-eslint/utils";

function makeVisitor() {
  const reported: string[] = [];
  const context = {
    report: (args: TSESLint.ReportDescriptor<"arbitraryValue">) => {
      if ("data" in args && args.data && "value" in args.data) {
        reported.push(String(args.data.value));
      }
    },
  } as unknown as TSESLint.RuleContext<"arbitraryValue", []>;
  const visitor = rule.create(context) as Record<
    string,
    (node: unknown) => void
  >;
  return { reported, visitor };
}

describe("no-arbitrary-tailwind-values", () => {
  it("exports a rule object with meta and create", () => {
    assert.ok(rule.meta);
    assert.ok(typeof rule.create === "function");
  });

  it("meta is configured with problem type", () => {
    assert.strictEqual(rule.meta.type, "problem");
  });

  it("allows active:scale-[0.98] exception", () => {
    const { reported, visitor } = makeVisitor();
    visitor.Literal({ value: "active:scale-[0.98] p-4" } as never);
    assert.strictEqual(reported.length, 0);
  });

  it("reports hover:scale-[0.98] as arbitrary value", () => {
    const { reported, visitor } = makeVisitor();
    visitor.Literal({ value: "hover:scale-[0.98] p-4" } as never);
    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0], "hover:scale-[0.98]");
  });

  it("reports bare scale-[0.98] as arbitrary value", () => {
    const { reported, visitor } = makeVisitor();
    visitor.Literal({ value: "scale-[0.98] p-4" } as never);
    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0], "scale-[0.98]");
  });
});
