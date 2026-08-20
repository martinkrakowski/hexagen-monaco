import assert from "node:assert/strict";
import { describe, it } from "vitest";
import rule from "../../src/rules/rhf-stable-array-keys.js";

import type { TSESLint } from "@typescript-eslint/utils";

function makeVisitor() {
  const reported: string[] = [];
  const context = {
    report: (
      args: TSESLint.ReportDescriptor<"missingKey" | "indexKey" | "staticKey">,
    ) => {
      reported.push(args.messageId);
    },
  } as unknown as TSESLint.RuleContext<
    "missingKey" | "indexKey" | "staticKey",
    []
  >;
  const visitor = rule.create(context) as Record<
    string,
    (node: unknown) => void
  >;
  return { reported, visitor };
}

describe("rhf-stable-array-keys", () => {
  it("exports a rule object with meta and create", () => {
    assert.ok(rule.meta);
    assert.ok(typeof rule.create === "function");
  });

  it("meta is configured with problem type", () => {
    assert.strictEqual(rule.meta.type, "problem");
  });

  it("reports missing key on component with dynamic fieldPrefix", () => {
    const { reported, visitor } = makeVisitor();

    visitor.JSXOpeningElement({
      type: "JSXOpeningElement" as never,
      attributes: [
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "fieldPrefix" },
          value: {
            type: "JSXExpressionContainer",
            expression: {
              type: "TemplateLiteral",
              quasis: [{ type: "TemplateElement" } as never],
              expressions: [{ type: "Identifier", name: "activeIndex" }],
            },
          },
        },
      ],
    } as never);

    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0], "missingKey");
  });

  it("reports index-based key on component with dynamic fieldPrefix", () => {
    const { reported, visitor } = makeVisitor();

    visitor.JSXOpeningElement({
      type: "JSXOpeningElement" as never,
      attributes: [
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "fieldPrefix" },
          value: {
            type: "JSXExpressionContainer",
            expression: {
              type: "TemplateLiteral",
              quasis: [{ type: "TemplateElement" } as never],
              expressions: [{ type: "Identifier", name: "activeIndex" }],
            },
          },
        },
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "key" },
          value: {
            type: "JSXExpressionContainer",
            expression: {
              type: "TemplateLiteral",
              quasis: [],
              expressions: [{ type: "Identifier", name: "activeIndex" }],
            },
          },
        },
      ],
    } as never);

    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0], "indexKey");
  });

  it("does not report when key uses semantic ID", () => {
    const { reported, visitor } = makeVisitor();

    visitor.JSXOpeningElement({
      type: "JSXOpeningElement" as never,
      attributes: [
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "fieldPrefix" },
          value: {
            type: "JSXExpressionContainer",
            expression: {
              type: "TemplateLiteral",
              quasis: [{ type: "TemplateElement" } as never],
              expressions: [{ type: "Identifier", name: "activeIndex" }],
            },
          },
        },
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "key" },
          value: {
            type: "JSXExpressionContainer",
            expression: {
              type: "MemberExpression",
              object: { type: "Identifier", name: "activeContext" },
              property: { type: "Identifier", name: "id" },
            },
          },
        },
      ],
    } as never);

    assert.strictEqual(reported.length, 0);
  });

  it("does not report components without dynamic RHF path props", () => {
    const { reported, visitor } = makeVisitor();

    visitor.JSXOpeningElement({
      type: "JSXOpeningElement" as never,
      attributes: [
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "className" },
          value: { type: "Literal", value: "flex" },
        },
      ],
    } as never);

    assert.strictEqual(reported.length, 0);
  });

  it("does not report components with only name prop (leaf-level RHF binding)", () => {
    const { reported, visitor } = makeVisitor();

    visitor.JSXOpeningElement({
      type: "JSXOpeningElement" as never,
      attributes: [
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "name" },
          value: {
            type: "JSXExpressionContainer",
            expression: {
              type: "TemplateLiteral",
              quasis: [],
              expressions: [{ type: "Identifier", name: "index" }],
            },
          },
        },
      ],
    } as never);

    assert.strictEqual(reported.length, 0);
  });

  it("does not report static template literals (no interpolation)", () => {
    const { reported, visitor } = makeVisitor();

    visitor.JSXOpeningElement({
      type: "JSXOpeningElement" as never,
      attributes: [
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "fieldPrefix" },
          value: {
            type: "JSXExpressionContainer",
            expression: {
              type: "TemplateLiteral",
              quasis: [{ type: "TemplateElement" } as never],
              expressions: [],
            },
          },
        },
      ],
    } as never);

    assert.strictEqual(reported.length, 0);
  });

  it("reports static string key on component with dynamic fieldPrefix", () => {
    const { reported, visitor } = makeVisitor();

    visitor.JSXOpeningElement({
      type: "JSXOpeningElement" as never,
      attributes: [
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "fieldPrefix" },
          value: {
            type: "JSXExpressionContainer",
            expression: {
              type: "TemplateLiteral",
              quasis: [],
              expressions: [{ type: "Identifier", name: "activeIndex" }],
            },
          },
        },
        {
          type: "JSXAttribute",
          name: { type: "JSXIdentifier", name: "key" },
          value: { type: "Literal", value: "static-key" },
        },
      ],
    } as never);

    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0], "staticKey");
  });
});
