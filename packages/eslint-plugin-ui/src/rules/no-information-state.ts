import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

const FORBIDDEN_PROPS = [
  "data",
  "loading",
  "error",
  "result",
  "isFetching",
  "isPending",
  "isSuccess",
  "isError",
  "governance",
  "llm",
  "status",
];

type MessageIds = "forbiddenProp";

const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow information-state prop names in UI components (Layer 2 firewall)",
    },
    messages: {
      forbiddenProp:
        'Prop "{{propName}}" leaks information state into the UI layer. Use interaction-state design (e.g., isExpanded, variant, onAction).',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node: TSESTree.JSXAttribute) {
        const name =
          node.name.type === "JSXIdentifier"
            ? node.name.name
            : node.name.type === "JSXNamespacedName"
              ? node.name.name.name
              : null;
        if (name && FORBIDDEN_PROPS.includes(name)) {
          context.report({
            node,
            messageId: "forbiddenProp",
            data: { propName: name },
          });
        }
      },
    };
  },
};

export default rule;
