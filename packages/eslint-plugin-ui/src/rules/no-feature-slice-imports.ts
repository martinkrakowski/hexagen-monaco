import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

type MessageIds = "crossSliceImport";

const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow cross-feature-slice imports (features may not import other features, except workspace-shell as composition root)",
    },
    messages: {
      crossSliceImport:
        'Feature "{{source}}" imports from feature "{{target}}". Features must be isolated — use shared packages or props instead.',
    },
    schema: [],
  },
  create(context) {
    const filePath = context.filename;
    const featuresMatch = filePath.match(/features\/([^/]+)/);
    if (!featuresMatch) return {};

    const sourceSlice = featuresMatch[1];
    if (sourceSlice === "workspace-shell") return {};

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        if (!source.startsWith("../") && !source.startsWith("./")) return;

        const resolved = new URL(source, `file://${filePath}`).pathname;
        const targetMatch = resolved.match(/features\/([^/]+)/);
        if (!targetMatch) return;

        const targetSlice = targetMatch[1];
        if (targetSlice === sourceSlice) return;

        context.report({
          node,
          messageId: "crossSliceImport",
          data: { source: sourceSlice, target: targetSlice },
        });
      },
    };
  },
};

export default rule;
