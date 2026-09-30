import ts from "typescript";

/**
 * The test names a file registers that can be read off its syntax alone.
 *
 * This exists to answer one question about a manifest's `command`: does its
 * `-t` pattern still select a test? `vitest -t` is a REGEX matched against a
 * test's full name, and a pattern that matches nothing skips every test and
 * exits 0 — which the replay reads as `survived`. A renamed test and a
 * surviving mutant are then spelled the same way, and the wrong one is the
 * confident answer.
 *
 * Two facts from vitest's own runner (`@vitest/runner`, v4) fix what a name is
 * and how it is matched, and this file is written to them:
 *
 *   getTaskFullName(task) = `${suite ? getTaskFullName(suite) + " " : ""}${name}`
 *   interpretTaskModes:     if (namePattern && !getTaskFullName(t).match(namePattern)) skip
 *   cli:                    testNamePattern = new RegExp(pattern)   // no flags
 *
 * So the full name is the enclosing `describe` titles and the test title joined
 * by a single space — the FILE's name is not part of it — and the pattern is an
 * unanchored regex over that string.
 *
 * ## What this returns, and what it deliberately does not
 *
 * It is SOUND, not complete: every name it returns is a name the file really
 * registers, but it does not claim to return all of them. Completeness is not
 * available from syntax — `test.each` formats its title per case from data
 * (`"…version (%s)…"`), a title can be an expression (`skipReason ?? "…"`), and
 * a test can be registered by a helper this file never sees. So an unresolved
 * title is dropped rather than guessed at, and a `describe` whose own title is
 * unresolved takes its whole subtree with it: a placeholder standing in for the
 * missing text would let a `.` or `.*` in a pattern match through it and prove
 * a name that does not exist.
 *
 * Soundness is what the caller needs. A pattern matching one of these names
 * selects a real test, and that is proof; a pattern matching none of them is
 * not yet a finding, because the name it wants may be one this file could not
 * build. The caller escalates that case to vitest itself.
 *
 * Dropping a suite prefix would break even soundness if patterns were anchored:
 * a name built here is always a SUFFIX of the real full name (a missed wrapper
 * only adds leading text), so any unanchored regex matching it matches the real
 * name too — but `^` would not survive that. The caller refuses to prove an
 * anchored pattern for exactly this reason.
 */

/** The globals vitest registers a suite or a test under. */
const NAMERS = new Set(["it", "test", "describe", "suite"]);

interface Namer {
  /** `describe`/`suite` open a scope; `it`/`test` register a name. */
  readonly suite: boolean;
  /** `.each` formats the title per case at runtime, so the literal is not a name. */
  readonly each: boolean;
  /**
   * Reached through `.skip`, `.todo`, `.skipIf` or `.runIf` (or `xit`/`xtest`/
   * `xdescribe`): the call may not run, and a test that does not run is not
   * proof that a `-t` pattern still selects one.
   */
  readonly skipped: boolean;
}

/** Modifiers after which the registration is not certain to run. */
const CONDITIONAL = new Set(["skip", "todo", "skipIf", "runIf"]);
/** The `x`-prefixed spellings vitest also accepts. */
const X_NAMERS = new Set(["xit", "xtest", "xdescribe"]);

/**
 * Walks `it`, `test.skipIf(x)`, `describe.each([…])`, ``test.each`…` `` and the
 * rest back to the global they hang off. Anything not rooted in one of the four
 * namers is not a registration.
 */
function namerOf(expression: ts.Expression): Namer | undefined {
  let node: ts.Node = expression;
  let each = false;
  let skipped = false;
  for (;;) {
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === "each") each = true;
      if (CONDITIONAL.has(node.name.text)) skipped = true;
      node = node.expression;
      continue;
    }
    if (ts.isCallExpression(node)) {
      node = node.expression;
      continue;
    }
    if (ts.isTaggedTemplateExpression(node)) {
      node = node.tag;
      continue;
    }
    break;
  }
  if (!ts.isIdentifier(node)) return undefined;
  if (X_NAMERS.has(node.text)) {
    return { suite: node.text === "xdescribe", each, skipped: true };
  }
  if (!NAMERS.has(node.text)) return undefined;
  return {
    suite: node.text === "describe" || node.text === "suite",
    each,
    skipped,
  };
}

/**
 * The title only when it is literally in the source. A template literal WITH
 * substitutions is an expression, not a title, and is refused here rather than
 * approximated.
 */
function literalTitle(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  return undefined;
}

export function testNames(source: string, fileName: string): readonly string[] {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names: string[] = [];
  // `undefined` means "inside a suite whose name could not be read" — every
  // name below it is unknowable, so none is claimed.
  const walk = (node: ts.Node, prefix: readonly string[] | undefined): void => {
    let inner = prefix;
    if (ts.isCallExpression(node)) {
      const namer = namerOf(node.expression);
      if (namer !== undefined) {
        // A skipped registration is treated like an unreadable title: no name
        // is claimed, and a skipped suite takes its subtree with it. What this
        // cannot see — an unreachable `if (false) test(…)` — is left to the
        // `vitest list` confirmation, because syntax cannot prove reachability.
        const title =
          namer.each || namer.skipped
            ? undefined
            : literalTitle(node.arguments[0]);
        const full =
          title === undefined || prefix === undefined
            ? undefined
            : [...prefix, title];
        if (namer.suite) inner = full;
        else if (full !== undefined) names.push(full.join(" "));
      }
    }
    node.forEachChild((child) => {
      walk(child, inner);
    });
  };
  walk(parsed, []);
  return names;
}
