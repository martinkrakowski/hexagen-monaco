import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

type MessageIds = "missingKey" | "indexKey" | "staticKey";

const INDEX_IDENTIFIERS = new Set([
  "index",
  "i",
  "idx",
  "activeIndex",
  "rowIndex",
  "colIndex",
]);

function isIndexLike(expr: TSESTree.Expression): boolean {
  if (expr.type === "Identifier") return INDEX_IDENTIFIERS.has(expr.name);
  if (expr.type === "TemplateLiteral") {
    return expr.expressions.some(
      (e) => e.type === "Identifier" && INDEX_IDENTIFIERS.has(e.name),
    );
  }
  if (
    expr.type === "BinaryExpression" &&
    expr.operator === "+" &&
    (expr.left.type === "Identifier" || expr.right.type === "Identifier")
  ) {
    return [expr.left, expr.right].some(
      (side) => side.type === "Identifier" && INDEX_IDENTIFIERS.has(side.name),
    );
  }
  return false;
}

const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce semantic keys on components driven by dynamic RHF array paths to prevent ambient state leaks",
    },
    messages: {
      missingKey:
        "Component with dynamic RHF array path prop (fieldPrefix) must have a stable semantic `key` prop (e.g., entity ID) to prevent stale DOM state retention across array mutations.",
      indexKey:
        "Do not use array indices as keys for components with dynamic RHF array paths. Deletions/insertions shift indices and leak ambient state. Use a stable semantic ID instead.",
      staticKey:
        "Static string keys are invalid for components with dynamic RHF array paths. The key must change when the bound entity changes — use a dynamic semantic ID instead.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement) {
        const hasDynamicRHFPath = node.attributes.some((attr) => {
          if (attr.type !== "JSXAttribute") return false;
          const name =
            attr.name.type === "JSXIdentifier" ? attr.name.name : null;
          if (name !== "fieldPrefix") return false;

          const value = attr.value;
          if (!value || value.type !== "JSXExpressionContainer") return false;
          return (
            value.expression.type === "TemplateLiteral" &&
            value.expression.expressions.length > 0
          );
        });

        if (!hasDynamicRHFPath) return;

        const keyAttr = node.attributes.find(
          (attr): attr is TSESTree.JSXAttribute =>
            attr.type === "JSXAttribute" &&
            attr.name.type === "JSXIdentifier" &&
            attr.name.name === "key",
        );

        if (!keyAttr) {
          context.report({ node, messageId: "missingKey" });
          return;
        }

        const keyValue = keyAttr.value;
        if (!keyValue) {
          context.report({ node: keyAttr, messageId: "staticKey" });
          return;
        }

        if (keyValue.type === "Literal" && typeof keyValue.value === "string") {
          context.report({ node: keyAttr, messageId: "staticKey" });
          return;
        }

        if (keyValue.type !== "JSXExpressionContainer") return;

        const expr = keyValue.expression;
        if (expr.type === "JSXEmptyExpression") return;

        if (isIndexLike(expr)) {
          context.report({ node: keyAttr, messageId: "indexKey" });
        }
      },
    };
  },
};

export default rule;
