import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import { ESLintUtils } from "@typescript-eslint/utils";
import ts from "typescript";

type MessageIds = "promiseInUntypedPosition";

/**
 * True when `type` is thenable: the type, or any member of a union, has a
 * callable `then` property.
 */
function isThenable(checker: ts.TypeChecker, type: ts.Type): boolean {
  const apparent = checker.getApparentType(type);
  const constituents = apparent.isUnion() ? apparent.types : [apparent];
  return constituents.some((t) => {
    const thenProp = t.getProperty("then");
    if (!thenProp) return false;
    const thenType = checker.getTypeOfSymbol(thenProp);
    return thenType.getCallSignatures().length > 0;
  });
}

/**
 * True when the contextual type is permissive enough to hide a promise:
 * absent, `any`, or `unknown`.
 */
function isUntypedContext(contextualType: ts.Type | undefined): boolean {
  if (contextualType === undefined) return true;
  const flags = contextualType.flags;
  return (
    (flags & ts.TypeFlags.Any) !== 0 || (flags & ts.TypeFlags.Unknown) !== 0
  );
}

/**
 * True when `type` is a type parameter whose constraint is permissive
 * (`any` or `unknown`, or unconstrained). An unconstrained type parameter
 * accepts anything, so a promise placed against it is hiding in inference
 * rather than being explicitly accepted.
 */
function isPermissiveTypeParameter(type: ts.Type): boolean {
  const constraint = type.getConstraint();
  if (constraint === undefined) return true;
  return isUntypedContext(constraint);
}

/**
 * True when the call's callee is a test helper whose parameters are `unknown`:
 * `expect(...)` or `assert*(...)` / `assert.equal(...)` etc.
 */
function isTestHelper(callee: TSESTree.Expression): boolean {
  if (callee.type === "Identifier") {
    return callee.name === "expect" || callee.name.startsWith("assert");
  }
  if (callee.type === "MemberExpression") {
    const obj = callee.object;
    if (obj.type === "Identifier") {
      return (
        obj.name === "expect" ||
        obj.name === "assert" ||
        obj.name.startsWith("assert")
      );
    }
  }
  return false;
}

/**
 * Disallow a promise placed where any value is accepted — the `any` / `unknown`
 * typed positions where no-floating-promises, no-misused-promises and
 * await-thenable do not fire.
 *
 * These type-aware rules catch a promise that is *bare* (a statement), used as
 * a *condition* (truthiness), or *awaited-but-not-thenable*. They do NOT catch
 * a promise that lands in a slot whose parameter type is `any` or `unknown`:
 * TypeScript accepts it, runtime receives `{}` instead of the resolved value.
 *
 * A particular hole is a generic function whose parameter is a *type
 * parameter* (`function f<T>(body: T)`) called with an object literal: the
 * type parameter is inferred from the argument, so `getContextualType` on a
 * property value returns the *inferred* type rather than `any` or `unknown`.
 * The enclosing call's parameter type is checked to detect this: when it is a
 * permissive type parameter, the position did not have an externally specified
 * expected type.
 *
 * This rule fills that gap. It is type-aware: when a file is linted without
 * type information it reports nothing and does not throw.
 */
const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a promise passed where any value is accepted (any/unknown-typed position)",
    },
    messages: {
      promiseInUntypedPosition:
        "A promise is passed where any value is accepted. Did you forget `await`? If the promise itself is meant, give the target a type that says so. (position: {{position}})",
    },
    schema: [],
  },
  create(context) {
    const parserServices = ESLintUtils.getParserServices(context, true);
    const program = parserServices.program;
    if (!program) return {};

    const checker = program.getTypeChecker();
    const nodeMap = parserServices.esTreeNodeToTSNodeMap;

    function reportUntyped(expr: TSESTree.Node, position: string) {
      context.report({
        node: expr,
        messageId: "promiseInUntypedPosition",
        data: { position },
      });
    }

    /**
     * Check an expression in one of the untyped-position sites (object
     * property, array element, call argument, template literal).
     * Reports when the expression is thenable and its contextual type is
     * permissive (undefined, any, or unknown).
     */
    function checkUntypedExpression(expr: TSESTree.Node, position: string) {
      const tsNode = nodeMap.get(expr) as ts.Expression;
      const type = checker.getTypeAtLocation(tsNode);
      if (!isThenable(checker, type)) return;
      const contextualType = checker.getContextualType(tsNode);
      if (!isUntypedContext(contextualType)) return;
      reportUntyped(expr, position);
    }

    return {
      // Position 1: object-literal property value (shorthand and computed
      // keys included).
      Property(node: TSESTree.Property) {
        if (node.parent?.type !== "ObjectExpression") return;
        if (node.kind !== "init" || node.method) return;
        const value = node.value;

        const tsNode = nodeMap.get(value) as ts.Expression;
        const type = checker.getTypeAtLocation(tsNode);
        if (!isThenable(checker, type)) return;

        const contextualType = checker.getContextualType(tsNode);
        if (isUntypedContext(contextualType)) {
          reportUntyped(value, "object-property");
          return;
        }
        if (!contextualType) return;

        // When the contextual type itself accepts promises (e.g. a field
        // typed Promise<boolean>) the promise is deliberate -- skip. But when
        // the contextual type is the *inferred* type of a generic type
        // parameter (the parameter type is a type parameter whose constraint
        // is unknown/any), the promise is hiding in the inference: report.
        if (isThenable(checker, contextualType)) {
          const objExpr = node.parent;
          const callExpr = objExpr.parent;
          if (
            callExpr &&
            (callExpr.type === "CallExpression" ||
              callExpr.type === "NewExpression")
          ) {
            const argIndex = callExpr.arguments.indexOf(objExpr);
            if (argIndex !== -1) {
              const tsCall = nodeMap.get(callExpr) as ts.CallExpression;
              const signature = checker.getResolvedSignature(tsCall);
              if (signature) {
                const paramSymbols = signature.getParameters();
                const paramSymbol = paramSymbols[argIndex];
                if (paramSymbol) {
                  const paramDecl = paramSymbol.valueDeclaration;
                  if (
                    paramDecl &&
                    ts.isParameter(paramDecl) &&
                    paramDecl.type
                  ) {
                    const refType = checker.getTypeFromTypeNode(paramDecl.type);
                    if (
                      refType.isTypeParameter() &&
                      isPermissiveTypeParameter(refType)
                    ) {
                      reportUntyped(value, "object-property");
                    }
                  }
                }
              }
            }
          }
          return;
        }

        // Anything else: the position expects a specific non-promise type and
        // TypeScript already flags the mismatch.
      },

      // Position 2: array-literal element.
      ArrayExpression(node: TSESTree.ArrayExpression) {
        for (const element of node.elements) {
          if (!element || element.type === "SpreadElement") continue;
          checkUntypedExpression(element, "array-element");
        }
      },

      // Position 3: argument of a call or new expression.
      // Skip test helpers (expect/assert*) whose parameters are unknown.
      CallExpression(node: TSESTree.CallExpression) {
        if (isTestHelper(node.callee)) return;
        for (const arg of node.arguments) {
          if (arg.type === "SpreadElement") continue;
          checkUntypedExpression(arg, "call-argument");
        }
      },
      NewExpression(node: TSESTree.NewExpression) {
        if (isTestHelper(node.callee)) return;
        for (const arg of node.arguments) {
          if (!arg) continue;
          checkUntypedExpression(arg, "call-argument");
        }
      },

      // Position 4: expression inside a template literal -- a promise in a
      // string is never meant, so report regardless of expected type.
      TemplateLiteral(node: TSESTree.TemplateLiteral) {
        for (const expr of node.expressions) {
          const tsNode = nodeMap.get(expr) as ts.Expression;
          const type = checker.getTypeAtLocation(tsNode);
          if (isThenable(checker, type)) {
            context.report({
              node: expr,
              messageId: "promiseInUntypedPosition",
              data: { position: "template-literal" },
            });
          }
        }
      },
    };
  },
};

export default rule;
