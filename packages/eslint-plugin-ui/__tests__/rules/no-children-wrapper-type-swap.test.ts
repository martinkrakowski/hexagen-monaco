import assert from "node:assert/strict";
import { describe, it } from "node:test";
import rule from "../../src/rules/no-children-wrapper-type-swap.js";

type Reported = { messageId: string; data?: Record<string, unknown> };

function makeVisitor() {
  const reported: Reported[] = [];
  const context = {
    report: (args: Reported) => reported.push(args),
  } as never;
  const visitor = rule.create(context) as Record<
    string,
    (node: unknown) => void
  >;
  return { reported, visitor };
}

const fn = { type: "FunctionDeclaration" } as never;

/** A `{children}` expression container wrapped by an element of the given tag. */
function childrenIn(tagName: unknown) {
  return {
    type: "JSXExpressionContainer",
    expression: { type: "Identifier", name: "children" },
    parent: { type: "JSXElement", openingElement: { name: tagName } },
  };
}

const divTag = { type: "JSXIdentifier", name: "div" };
const providerTag = {
  type: "JSXMemberExpression",
  object: { type: "JSXIdentifier", name: "LocalLLMContext" },
  property: { type: "JSXIdentifier", name: "Provider" },
};

describe("no-children-wrapper-type-swap", () => {
  it("exports a rule object with meta and create", () => {
    assert.ok(rule.meta);
    assert.ok(typeof rule.create === "function");
  });

  it("meta is configured with problem type", () => {
    assert.strictEqual(rule.meta.type, "problem");
  });

  it("reports when {children} is wrapped in two different element types", () => {
    const { reported, visitor } = makeVisitor();
    visitor.FunctionDeclaration(fn);
    visitor.JSXExpressionContainer(childrenIn(divTag));
    visitor.JSXExpressionContainer(childrenIn(providerTag));
    visitor["FunctionDeclaration:exit"](fn);

    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0].messageId, "wrapperTypeSwap");
    assert.strictEqual(
      reported[0].data?.types,
      "div / LocalLLMContext.Provider",
    );
  });

  it("does not report when {children} keeps the same wrapper type", () => {
    const { reported, visitor } = makeVisitor();
    visitor.FunctionDeclaration(fn);
    visitor.JSXExpressionContainer(childrenIn(divTag));
    visitor.JSXExpressionContainer(childrenIn({ ...divTag }));
    visitor["FunctionDeclaration:exit"](fn);

    assert.strictEqual(reported.length, 0);
  });

  it("does not report a single wrapped {children}", () => {
    const { reported, visitor } = makeVisitor();
    visitor.FunctionDeclaration(fn);
    visitor.JSXExpressionContainer(childrenIn(providerTag));
    visitor["FunctionDeclaration:exit"](fn);

    assert.strictEqual(reported.length, 0);
  });

  it("ignores non-children expression containers", () => {
    const { reported, visitor } = makeVisitor();
    visitor.FunctionDeclaration(fn);
    // a `{value}` container wrapped in a provider — must not count
    visitor.JSXExpressionContainer({
      type: "JSXExpressionContainer",
      expression: { type: "Identifier", name: "value" },
      parent: { type: "JSXElement", openingElement: { name: providerTag } },
    } as never);
    visitor.JSXExpressionContainer(childrenIn(divTag));
    visitor["FunctionDeclaration:exit"](fn);

    assert.strictEqual(reported.length, 0);
  });

  it("treats a Fragment wrapper as distinct from an element wrapper", () => {
    const { reported, visitor } = makeVisitor();
    visitor.FunctionDeclaration(fn);
    visitor.JSXExpressionContainer({
      type: "JSXExpressionContainer",
      expression: { type: "Identifier", name: "children" },
      parent: { type: "JSXFragment" },
    } as never);
    visitor.JSXExpressionContainer(childrenIn(divTag));
    visitor["FunctionDeclaration:exit"](fn);

    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0].messageId, "wrapperTypeSwap");
  });
});
