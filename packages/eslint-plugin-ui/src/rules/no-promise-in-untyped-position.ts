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
 *
 * Known limitation: `identity<T>(x: T)` called with an argument whose type is
 * thenable is reported, because the rule cannot tell an identity function from
 * a sink that accepts `T` (a generic type parameter). The same applies to
 * `Promise.resolve<T>(value: T)` in TS 5.9+ (its parameter is a bare type
 * parameter on the signature). The fix is to give the target a type or to
 * `await`. A call with explicit type arguments (e.g.
 * `identity<Promise<boolean>>(x)`) is treated as deliberate and is not
 * flagged.
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

    /**
     * True when argument `argIndex` of `call` lands in a parameter whose
     * declared type is a bare type parameter that (a) accepts anything and
     * (b) belongs to the called signature itself, so its "expected type" is
     * only what was inferred from the argument. A class-level type parameter
     * the receiver has instantiated (Map<K, V>.set) is somebody's deliberate
     * type and is excluded, as is a call with explicit type arguments.
     */
    function isSignatureLevelOpenParam(
      call: ts.CallExpression | ts.NewExpression,
      argIndex: number,
    ): boolean {
      if (call.typeArguments && call.typeArguments.length > 0) return false;
      const signature = checker.getResolvedSignature(call);
      const declaration = signature?.getDeclaration();
      if (!declaration) return false;
      const param = declaration.parameters[argIndex];
      if (!param || !param.type || param.dotDotDotToken) return false;
      const declared = checker.getTypeFromTypeNode(param.type);
      if (!declared.isTypeParameter()) return false;
      const typeParamDecl = declared.symbol?.declarations?.[0];
      if (!typeParamDecl || typeParamDecl.parent !== declaration) return false;
      const constraint = declared.getConstraint();
      return (
        !constraint ||
        (constraint.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0
      );
    }

    function reportUntyped(expr: TSESTree.Node, position: string) {
      context.report({
        node: expr,
        messageId: "promiseInUntypedPosition",
        data: { position },
      });
    }

    /**
     * If `node` is a direct argument of a CallExpression or NewExpression,
     * return that call's TS node and the argument index.
     */
    function getEnclosingCallInfo(node: TSESTree.Node): {
      tsCall: ts.CallExpression | ts.NewExpression;
      argIndex: number;
    } | null {
      const parent = node.parent;
      if (
        !parent ||
        (parent.type !== "CallExpression" && parent.type !== "NewExpression")
      ) {
        return null;
      }
      for (let i = 0; i < parent.arguments.length; i++) {
        if (parent.arguments[i] === node) {
          return {
            tsCall: nodeMap.get(parent) as ts.CallExpression | ts.NewExpression,
            argIndex: i,
          };
        }
      }
      return null;
    }

    /**
     * Check an expression in one of the untyped-position sites (object
     * property, array element, call argument, template literal).
     * Reports when the expression is thenable and its contextual type is
     * permissive (undefined, any, or unknown).
     */
    function checkUntypedExpression(
      expr: TSESTree.Node,
      position: string,
      tsCall?: ts.CallExpression | ts.NewExpression,
      argIndex?: number,
    ) {
      const tsNode = nodeMap.get(expr) as ts.Expression;
      const type = checker.getTypeAtLocation(tsNode);
      if (!isThenable(checker, type)) return;
      const contextualType = checker.getContextualType(tsNode);
      if (isUntypedContext(contextualType)) {
        reportUntyped(expr, position);
        return;
      }
      if (!contextualType) return;
      if (
        tsCall !== undefined &&
        argIndex !== undefined &&
        isSignatureLevelOpenParam(tsCall, argIndex)
      ) {
        reportUntyped(expr, position);
      }
    }

    return {
      // Position 1: object-literal property value (shorthand and computed
      // keys included).
      Property(node: TSESTree.Property) {
        if (node.parent?.type !== "ObjectExpression") return;
        if (node.kind !== "init" || node.method) return;
        const value = node.value;
        const callInfo = getEnclosingCallInfo(node.parent);
        checkUntypedExpression(
          value,
          "object-property",
          callInfo?.tsCall,
          callInfo?.argIndex,
        );
      },

      // Position 2: array-literal element.
      ArrayExpression(node: TSESTree.ArrayExpression) {
        const callInfo = getEnclosingCallInfo(node);
        for (const element of node.elements) {
          if (!element || element.type === "SpreadElement") continue;
          checkUntypedExpression(
            element,
            "array-element",
            callInfo?.tsCall,
            callInfo?.argIndex,
          );
        }
      },

      // Position 3: argument of a call or new expression.
      // Skip test helpers (expect/assert*) whose parameters are unknown.
      CallExpression(node: TSESTree.CallExpression) {
        if (isTestHelper(node.callee)) return;
        const tsCall = nodeMap.get(node) as ts.CallExpression;
        for (let i = 0; i < node.arguments.length; i++) {
          const arg = node.arguments[i];
          if (arg.type === "SpreadElement") continue;
          checkUntypedExpression(arg, "call-argument", tsCall, i);
        }
      },
      NewExpression(node: TSESTree.NewExpression) {
        if (isTestHelper(node.callee)) return;
        const tsCall = nodeMap.get(node) as ts.NewExpression;
        for (let i = 0; i < node.arguments.length; i++) {
          const arg = node.arguments[i];
          if (!arg || arg.type === "SpreadElement") continue;
          checkUntypedExpression(arg, "call-argument", tsCall, i);
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
