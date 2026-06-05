import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

type MessageIds = "wrapperTypeSwap";

type FnNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

/** Render a JSX tag name (identifier, member, or namespaced) as a string. */
function jsxNameToString(name: TSESTree.JSXTagNameExpression): string {
  switch (name.type) {
    case "JSXIdentifier":
      return name.name;
    case "JSXNamespacedName":
      return `${name.namespace.name}:${name.name.name}`;
    case "JSXMemberExpression":
      return `${jsxNameToString(name.object)}.${name.property.name}`;
    default:
      return "unknown";
  }
}

/** Human-readable name for the element/fragment wrapping {children}. */
function wrapperName(node: TSESTree.JSXElement | TSESTree.JSXFragment): string {
  if (node.type === "JSXFragment") return "<>";
  return jsxNameToString(node.openingElement.name);
}

/**
 * Disallow wrapping `{children}` in different element *types* across a
 * component's render paths.
 *
 * React reconciles by position + element type. When the element type wrapping
 * `{children}` changes between renders — the classic case being a
 * `<div className="contents">{children}</div>` hydration gate that flips to
 * `<Ctx.Provider>{children}</Ctx.Provider>` once a `mounted` flag is set —
 * React tears down and rebuilds the entire subtree instead of re-using it. That
 * double-mounts every descendant on first load (re-running effects, replaying
 * entrance animations). Keep one stable wrapper and vary props/values instead.
 */
const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow wrapping {children} in different element types across a component's return paths, which forces React to remount the whole subtree",
    },
    messages: {
      wrapperTypeSwap:
        "`{children}` is wrapped in different element types across this component's render paths ({{types}}). Swapping the element type around `children` forces React to unmount and remount the entire subtree (e.g. a double-mount on first load when a `mounted`/hydration flag flips). Keep one stable wrapper and vary props/values instead — e.g. `<Ctx.Provider value={mounted ? real : fallback}>{children}</Ctx.Provider>`.",
    },
    schema: [],
  },
  create(context) {
    // One scope per component function; tracks the distinct wrapper types seen
    // directly around a `{children}` expression (deduped by type name).
    const stack: Array<{ fn: FnNode; wrappers: Map<string, TSESTree.Node> }> =
      [];

    function enterFn(node: FnNode) {
      stack.push({ fn: node, wrappers: new Map() });
    }

    function exitFn() {
      const scope = stack.pop();
      if (!scope || scope.wrappers.size < 2) return;
      context.report({
        node: scope.fn,
        messageId: "wrapperTypeSwap",
        data: { types: Array.from(scope.wrappers.keys()).join(" / ") },
      });
    }

    return {
      FunctionDeclaration: enterFn,
      "FunctionDeclaration:exit": exitFn,
      FunctionExpression: enterFn,
      "FunctionExpression:exit": exitFn,
      ArrowFunctionExpression: enterFn,
      "ArrowFunctionExpression:exit": exitFn,
      JSXExpressionContainer(node: TSESTree.JSXExpressionContainer) {
        // Only a bare `{children}` render site.
        if (
          node.expression.type !== "Identifier" ||
          node.expression.name !== "children"
        ) {
          return;
        }
        // Its wrapper is the JSX element/fragment that directly contains it.
        const parent = node.parent;
        if (
          !parent ||
          (parent.type !== "JSXElement" && parent.type !== "JSXFragment")
        ) {
          return;
        }
        const scope = stack[stack.length - 1];
        if (!scope) return;
        const name = wrapperName(parent);
        if (!scope.wrappers.has(name)) scope.wrappers.set(name, parent);
      },
    };
  },
};

export default rule;
