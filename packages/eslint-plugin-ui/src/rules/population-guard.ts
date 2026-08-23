import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

type MessageIds = "unguardedNegative";

/**
 * population-guard — assert non-empty before asserting clean.
 *
 * Flags a negative-shape assertion inside a test body when no positive
 * population assertion on the same subject precedes it in that body:
 *
 *   expect(x).not.toContain(...)      expect(x).not.toMatch(...)
 *   expect(x).not.toHaveLength(0)     expect(f(...)).toEqual([])
 *                                     expect(f(...)).toStrictEqual([])
 *
 * The `toEqual([])` / `toStrictEqual([])` forms are only flagged when the
 * subject is a call result — `expect(residue()).toEqual([])` — because that
 * is the shape in which "nothing survived" silently becomes "nothing was
 * checked" (catalogue §1.1: #421, #478, #499–#501, #518, #570, #595, #616,
 * #626). An identifier subject may hold a legitimately-empty literal.
 *
 * Counted as positive population guards, when they precede the negative and
 * name the same subject:
 *
 *   expect(x).toHaveLength(n)            // n > 0 or non-literal
 *   expect(x.length).toBe(n) / toEqual(n) / toBeGreaterThan(0)
 *                            / toBeGreaterThanOrEqual(n >= 1)
 *   assert.ok(x.length > 0) / assert.ok(x.length >= 1)
 *   assert.equal(x.length, n) / assert.strictEqual(x.length, n)   // n > 0
 *
 * `expect(x).not.toHaveLength(0)` is itself a negative shape and never
 * counts as a guard.
 *
 * Escape hatch — a comment on the flagged line or the line above:
 *
 *   // population-guard: <reason>
 *
 * HONESTY CLAUSE. This rule is a syntactic tripwire, not a proof. It cannot
 * see that a population was empty at runtime, cannot follow a helper that
 * asserts on the caller's behalf, and will flag legitimately-empty
 * expectations. Its value is that it makes the author write the guard or
 * write the reason. If the sweep produces more allow-list comments than
 * fixes, that is evidence the rule is noise — D-4's recorded downgrade
 * condition is to demote it to doctrine and say so.
 *
 * Known limitations (deliberate, to stay syntactic): subjects are compared
 * by normalized source text; a guard placed in beforeEach or a helper does
 * not count; `toEqual([])` on an identifier initialized from a call is not
 * flagged; assert-style NEGATIVE shapes (assert.deepEqual(x, []) and
 * friends) are out of v1 scope.
 */

const TEST_CALLEES = new Set(["it", "test"]);
const TEST_MODIFIERS = new Set([
  "only",
  "skip",
  "each",
  "fails",
  "concurrent",
  "sequential",
  "todo",
]);

function normalize(text: string): string {
  return text.replace(/\s+/g, "");
}

/** `it(...)` / `test(...)` / `it.only(...)` / `it.each(...)(...)`. */
function isTestCall(call: TSESTree.CallExpression): boolean {
  const callee = call.callee;
  if (callee.type === "Identifier") return TEST_CALLEES.has(callee.name);
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    TEST_CALLEES.has(callee.object.name) &&
    callee.property.type === "Identifier" &&
    TEST_MODIFIERS.has(callee.property.name)
  ) {
    return true;
  }
  // it.each([...])("name", fn) — callee is itself a CallExpression.
  if (callee.type === "CallExpression") return isTestCall(callee);
  return false;
}

/** Nearest enclosing function that is an argument of a test call. */
function enclosingTestBody(node: TSESTree.Node): TSESTree.Node | null {
  let current: TSESTree.Node | undefined = node.parent;
  while (current) {
    if (
      (current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression") &&
      current.parent?.type === "CallExpression" &&
      (current.parent.arguments as TSESTree.Node[]).includes(current) &&
      isTestCall(current.parent)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** The argument of `expect(...)` for a member chain, unwrapping `.not`. */
function expectSubject(
  member: TSESTree.MemberExpression,
  wantNot: boolean,
): TSESTree.Expression | null {
  let object: TSESTree.Expression = member.object;
  let sawNot = false;
  if (
    object.type === "MemberExpression" &&
    object.property.type === "Identifier" &&
    object.property.name === "not"
  ) {
    sawNot = true;
    object = object.object;
  }
  if (sawNot !== wantNot) return null;
  if (
    object.type === "CallExpression" &&
    object.callee.type === "Identifier" &&
    object.callee.name === "expect" &&
    object.arguments.length === 1 &&
    object.arguments[0].type !== "SpreadElement"
  ) {
    return object.arguments[0];
  }
  return null;
}

function isZeroLiteral(node: TSESTree.Node | undefined): boolean {
  return node?.type === "Literal" && node.value === 0;
}

function isPositiveNumberLiteral(node: TSESTree.Node | undefined): boolean {
  return (
    node?.type === "Literal" && typeof node.value === "number" && node.value > 0
  );
}

/** `<subject>.length` → subject; otherwise null. */
function lengthSubject(
  node: TSESTree.Node | undefined,
): TSESTree.Expression | null {
  if (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "length"
  ) {
    return node.object;
  }
  return null;
}

const rule: TSESLint.RuleModule<MessageIds> = {
  defaultOptions: [],
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a positive population assertion before a negative-shape assertion in the same test body (assert non-empty before asserting clean)",
    },
    messages: {
      unguardedNegative:
        "Negative assertion on `{{subject}}` with no preceding population guard in this test. Assert the population is non-empty first (e.g. expect({{subject}}).toHaveLength(n) or expect({{subject}}.length).toBeGreaterThan(0)), or add `// population-guard: <reason>` if an empty population is the intended expectation. This tripwire cannot see runtime emptiness or helpers that assert for you — see the rule doc.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    // test body node -> normalized subject texts guarded so far. Traversal is
    // source order, so a guard is recorded before any negative that follows
    // it; a guard placed after the negative never suppresses the report.
    const guarded = new Map<TSESTree.Node, Set<string>>();

    function recordGuard(body: TSESTree.Node | null, subject: string): void {
      if (!body) return;
      let set = guarded.get(body);
      if (!set) {
        set = new Set();
        guarded.set(body, set);
      }
      set.add(subject);
    }

    function hasAllowComment(node: TSESTree.Node): boolean {
      const line = node.loc.start.line;
      return sourceCode
        .getAllComments()
        .some(
          (comment) =>
            comment.value.trim().startsWith("population-guard:") &&
            comment.value.trim().length > "population-guard:".length &&
            (comment.loc.end.line === line ||
              comment.loc.end.line === line - 1),
        );
    }

    function report(node: TSESTree.Node, subject: TSESTree.Expression): void {
      const body = enclosingTestBody(node);
      if (!body) return; // helpers and non-test code are out of scope
      const key = normalize(sourceCode.getText(subject));
      if (guarded.get(body)?.has(key)) return;
      if (hasAllowComment(node)) return;
      context.report({
        node,
        messageId: "unguardedNegative",
        data: { subject: sourceCode.getText(subject) },
      });
    }

    return {
      CallExpression(node: TSESTree.CallExpression) {
        const callee = node.callee;

        // ---- assert-style guards: assert.ok(x.length > 0),
        //      assert.[strict]equal(x.length, n>0)
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "assert" &&
          callee.property.type === "Identifier"
        ) {
          const method = callee.property.name;
          const [first, second] = node.arguments;
          if (method === "ok" && first?.type === "BinaryExpression") {
            const subj = lengthSubject(first.left);
            const cmpZero =
              first.operator === ">" && isZeroLiteral(first.right);
            const cmpOne =
              first.operator === ">=" && isPositiveNumberLiteral(first.right);
            if (subj && (cmpZero || cmpOne)) {
              recordGuard(
                enclosingTestBody(node),
                normalize(sourceCode.getText(subj)),
              );
            }
          }
          if (
            (method === "equal" || method === "strictEqual") &&
            isPositiveNumberLiteral(second)
          ) {
            const subj = lengthSubject(first);
            if (subj) {
              recordGuard(
                enclosingTestBody(node),
                normalize(sourceCode.getText(subj)),
              );
            }
          }
          return;
        }

        if (callee.type !== "MemberExpression") return;
        if (callee.property.type !== "Identifier") return;
        const matcher = callee.property.name;

        // ---- expect-style guards
        if (matcher === "toHaveLength") {
          const subject = expectSubject(callee, false);
          const arg = node.arguments[0];
          if (subject && arg && !isZeroLiteral(arg)) {
            recordGuard(
              enclosingTestBody(node),
              normalize(sourceCode.getText(subject)),
            );
          }
          // fallthrough: expect(x).toHaveLength(0) asserts intentional
          // emptiness and is neither a guard nor a flagged negative.
        }
        if (
          matcher === "toBe" ||
          matcher === "toEqual" ||
          matcher === "toStrictEqual" ||
          matcher === "toBeGreaterThan" ||
          matcher === "toBeGreaterThanOrEqual"
        ) {
          const subject = expectSubject(callee, false);
          const lenSubj = subject ? lengthSubject(subject) : null;
          const arg = node.arguments[0];
          const positive =
            matcher === "toBeGreaterThan"
              ? isZeroLiteral(arg) || isPositiveNumberLiteral(arg)
              : isPositiveNumberLiteral(arg);
          if (lenSubj && positive) {
            recordGuard(
              enclosingTestBody(node),
              normalize(sourceCode.getText(lenSubj)),
            );
          }
        }

        // ---- negative shapes
        if (matcher === "toContain" || matcher === "toMatch") {
          const subject = expectSubject(callee, true);
          if (subject) report(node, subject);
          return;
        }
        if (matcher === "toHaveLength" && isZeroLiteral(node.arguments[0])) {
          const subject = expectSubject(callee, true);
          if (subject) report(node, subject);
          return;
        }
        if (matcher === "toEqual" || matcher === "toStrictEqual") {
          const arg = node.arguments[0];
          const emptyArray =
            arg?.type === "ArrayExpression" && arg.elements.length === 0;
          if (!emptyArray) return;
          const subject = expectSubject(callee, false);
          const isCallResult =
            subject &&
            (subject.type === "CallExpression" ||
              (subject.type === "AwaitExpression" &&
                subject.argument.type === "CallExpression"));
          if (subject && isCallResult) report(node, subject);
        }
      },
    };
  },
};

export default rule;
