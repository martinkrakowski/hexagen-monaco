import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import ts from "typescript";

/**
 * Layer guard: nothing under `src/domain/` may declare a member whose name is
 * renderer vocabulary (HEX-030).
 *
 * Why a test and not the arch linter. `yarn lint:arch` reasons about *import
 * edges*. The defect this guards is a **type shape**: `extent?: "parent"`,
 * `style?: { zIndex?: number }`, `variant?: NodeVisualProps` and
 * `className?: string` sat on `HexagonNodeWithLayout` / `HexagonEdge` and
 * introduced no import at all, so no specifier-based rule could ever see them.
 * That is the same blind spot `application-layer-io.guard.test.ts` was written
 * for one layer up, and this file follows its shape deliberately.
 *
 * Two layers of protection, and this is the second one. The first is
 * `DOMAIN_GRAPH_CARRIES_NO_PRESENTATION` in
 * `src/application/ports/out/renderable-graph.ts` — a compile-time assignment in
 * production code asserting the domain and presentation key sets are disjoint.
 * That one is exact but closed: it can only notice the four names the
 * presentation type already declares. This one is open: it fails on renderer
 * vocabulary the split has never seen, e.g. someone adding `hidden`,
 * `selectable` or `measured` to a domain node next year.
 *
 * Parsed, not grepped, for the reason spelled out at length in the application
 * guard: a substring scan matches the word `style` in a comment and misses
 * nothing useful in exchange. This walk reads property *declarations* only —
 * `interface X { style: … }`, `type X = { style: … }`, `class X { style: … }`
 * and a `constructor(readonly style: …)` parameter property — so a comment, a
 * string literal, a local variable and a plain function parameter named `style`
 * are all invisible.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../..");
const DOMAIN_DIR = path.join(PACKAGE_ROOT, "src", "domain");

/**
 * Member names owned by React Flow, CSS or SVG.
 *
 * The criterion, stated once and applied uniformly: a name is here when it
 * could not be carried across a swap away from React Flow / CSS / SVG without
 * translation, because it means nothing outside that renderer. The first block
 * is what HEX-030 actually removed; the second is the obvious neighbourhood,
 * listed now rather than after the next review finds one.
 */
const RENDERER_MEMBER_NAMES = new Set([
  // Removed by HEX-030.
  "extent",
  "draggable",
  "variant",
  "style",
  "className",
  "markerEnd",
  "animated",
  // Same vocabulary, not yet used here.
  "classNames",
  "css",
  "sx",
  "zIndex",
  "hidden",
  "selected",
  "selectable",
  "connectable",
  "deletable",
  "focusable",
  "dragging",
  "dragHandle",
  "measured",
  "sourcePosition",
  "targetPosition",
  "markerStart",
  "handles",
  "ariaLabel",
  "color",
  "colour",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeDasharray",
  "opacity",
]);

/**
 * Names that read like styling and are deliberately allowed, each with the
 * reason it survived the criterion above. Kept as an explicit map rather than
 * silence so a reader can audit the judgement calls instead of inferring them
 * from what the ban list omits.
 */
const DELIBERATELY_DOMAIN: Record<string, string> = {
  position:
    "a graph coordinate produced by ELK, persisted, and mutated by drag — geometry, not styling; HEX-030's own recommendation keeps it",
  side: "the hexagonal compass (north = primary adapter) — this repo's architectural vocabulary",
  type: "`HexagonNodeType` is bounded-context / entity / port / use-case / adapter — DDD kinds, not renderer ids",
  label: "the text on the node or edge is graph content",
  sourceHandle:
    "React Flow's prop name, but the VALUES are the compass directions and the `pub_`/`sub_` domain-event prefixes that useCanvasValidation applies a connection rule to",
  targetHandle: "see sourceHandle",
};

function typeScriptFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...typeScriptFilesUnder(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

function parse(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

/**
 * Every property name declared by a type in this file, at any nesting depth
 * (`style?: { zIndex?: number }` must yield both `style` and `zIndex`).
 *
 * Three declaration forms, because a domain type is not always an interface:
 *
 *  - `PropertySignature` — `interface X { style: … }` and the members of
 *    inline / aliased object type literals.
 *  - `PropertyDeclaration` — `class X { style?: … }`. The domain is all
 *    interfaces and functions today, so this collects nothing right now; it is
 *    here because "declare it on a class instead" is otherwise a way through
 *    the guard, and a guard with a known bypass is worth less than its lines.
 *  - A constructor **parameter property** — `constructor(readonly style: …)`,
 *    which declares a public member from a parameter position. Only parameters
 *    carrying `public` / `private` / `protected` / `readonly` count: a plain
 *    function parameter named `style` declares nothing and must stay invisible,
 *    which the decoy case below pins.
 *
 * A `PropertyAssignment` — the `document: 1` in an object *value* — is not a
 * declaration in any of those senses and is not collected, which is what keeps
 * a config literal or a returned object out of the scan.
 *
 * ## Names the walk cannot read, and why it fails instead of shrugging
 *
 * `interface X { ["style"]?: … }` is legal TypeScript — a computed member name
 * over a literal type — and `keyof X` still resolves it to `"style"`. A walk
 * that only reads `Identifier` and `StringLiteral` names discards the whole
 * `ComputedPropertyName` and reports the layer clean. Literal computed names
 * are therefore unwrapped below and treated exactly like plain ones.
 *
 * A computed name that is *not* a literal — `[STYLE_KEY]`, `[Tokens.style]`,
 * `[Symbol.iterator]` — cannot be resolved by syntax alone; it needs a type
 * checker this walk deliberately does not build. Rather than let that be the
 * remaining way through, such a name is collected separately and asserted to
 * be absent: a domain type may not declare a member under a name the guard
 * cannot read. There are none today, so the ratchet costs nothing now and
 * leaves no residue. A `#private` class field is not part of the type surface
 * and is skipped.
 */
const MEMBER_MODIFIERS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
]);

function isParameterProperty(node: ts.Node): node is ts.ParameterDeclaration {
  return (
    ts.isParameter(node) &&
    (node.modifiers ?? []).some((m) => MEMBER_MODIFIERS.has(m.kind))
  );
}

interface DeclaredMembers {
  /** Member names the walk resolved to a string. */
  names: string[];
  /** Computed names it could not resolve, as written. */
  unresolvedComputed: string[];
}

function declaredMembers(file: ts.SourceFile): DeclaredMembers {
  const names: string[] = [];
  const unresolvedComputed: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node) ||
      isParameterProperty(node)
    ) {
      const { name } = node;
      if (
        ts.isIdentifier(name) ||
        ts.isStringLiteral(name) ||
        ts.isNumericLiteral(name)
      ) {
        names.push(name.text);
      } else if (ts.isComputedPropertyName(name)) {
        const { expression } = name;
        if (
          ts.isStringLiteralLike(expression) ||
          ts.isNumericLiteral(expression)
        ) {
          names.push(expression.text);
        } else {
          unresolvedComputed.push(`[${expression.getText(file)}]`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return { names, unresolvedComputed };
}

function declaredPropertyNames(file: ts.SourceFile): string[] {
  return declaredMembers(file).names;
}

describe("the domain layer declares no renderer vocabulary", () => {
  const files = typeScriptFilesUnder(DOMAIN_DIR);
  const declarations = files.map((filePath) => ({
    filePath,
    ...declaredMembers(parse(filePath, readFileSync(filePath, "utf8"))),
  }));

  /**
   * Anti-vacuity. A scan that finds no files, or finds files but extracts no
   * property names from them, asserts "the population is clean" about an empty
   * population and goes green the moment its extractor drifts. This repo has
   * measured that failure twice, so the guard proves it is looking at something
   * before it reports the something is clean.
   */
  it("discovers the domain layer, and really reads property declarations", () => {
    assert.ok(
      files.length > 5,
      `expected more than 5 domain modules, found ${files.length} — discovery is broken`,
    );
    assert.ok(
      files.some((f) =>
        f.endsWith(path.join("hexagon-node", "hexagon-node.ts")),
      ),
      "discovery did not find hexagon-node.ts, the module HEX-030 was written for",
    );

    const allNames = declarations.flatMap((d) => d.names);
    assert.ok(
      allNames.length > 20,
      `extracted only ${allNames.length} property declarations from ${files.length} files — the walk is broken, not the layer`,
    );

    // Named anchors, so a walk that starts returning only *some* shapes is
    // caught. `position` is a plain member; `zoom` lives on CanvasViewport;
    // `aggregateItems` is nested two object literals deep inside `stats`,
    // which is exactly the depth `style: { zIndex }` hid at.
    for (const anchor of ["position", "zoom", "aggregateItems"]) {
      assert.ok(
        allNames.includes(anchor),
        `expected the walk to see \`${anchor}\`; it did not, so nested/plain members are being skipped`,
      );
    }

    // And the allow-map documents names the walk can actually observe, rather
    // than becoming a list of ghosts.
    assert.ok(
      Object.keys(DELIBERATELY_DOMAIN).some((n) => allNames.includes(n)),
      "no name in DELIBERATELY_DOMAIN is declared anywhere in the domain — the map has gone stale",
    );
  });

  it("declares no React Flow, CSS or SVG member on a domain type", () => {
    const violations: string[] = [];
    for (const { filePath, names } of declarations) {
      for (const name of names) {
        if (!RENDERER_MEMBER_NAMES.has(name)) continue;
        violations.push(
          `${path.relative(PACKAGE_ROOT, filePath)} declares \`${name}\``,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `HEX-030: a domain type is carrying renderer vocabulary.\n` +
        `These names introduce no import, so \`yarn lint:arch\` cannot see them.\n` +
        `Put the field on HexagonNodePresentation / HexagonEdgePresentation in\n` +
        `src/application/ports/out/renderable-graph.ts — or delete it if, like\n` +
        `\`draggable\` and \`markerEnd\`, no renderer actually reads it.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });

  /**
   * Fail closed. The assertion above can only judge names it managed to read;
   * a computed member name that is not a literal — `[STYLE_KEY]`,
   * `[Tokens.style]` — is not readable without a type checker, so allowing one
   * would leave "spell it as a constant" as the way through. There are none in
   * the domain today, so this forbids a shape rather than fixing a violation.
   */
  it("declares no member under a name the guard cannot read", () => {
    const unreadable: string[] = [];
    for (const { filePath, unresolvedComputed } of declarations) {
      for (const written of unresolvedComputed) {
        unreadable.push(
          `${path.relative(PACKAGE_ROOT, filePath)} declares \`${written}\``,
        );
      }
    }

    assert.deepEqual(
      unreadable,
      [],
      `A domain type declares a member under a computed name this guard cannot\n` +
        `resolve, so it cannot tell whether the name is renderer vocabulary.\n` +
        `Write the member with a literal name — \`style\` or \`["style"]\` — or,\n` +
        `if the indirection is load-bearing, teach this walk to resolve it.\n\n` +
        unreadable.map((v) => `  - ${v}`).join("\n"),
    );
  });

  /**
   * Attack the walk itself, the way the application guard does. A guard is
   * worth its line count only if it fires on the real shape and stays silent on
   * the text that would have made a substring scan unusable.
   */
  describe("the walk itself", () => {
    it("sees nothing in comments, strings, values or parameters", () => {
      const file = parse(
        "decoy.ts",
        [
          "// The style and className fields moved to the presentation DTO.",
          "/** JSDoc naming {@link extent} and variant and markerEnd. */",
          'const css = "style: { zIndex: 20 }";',
          "const config = { style: 1, className: 2, extent: 3 };",
          "export function render(style: string, className: string) {",
          "  const variant = style + className;",
          "  return variant;",
          "}",
          "export { css, config };",
        ].join("\n"),
      );

      assert.deepEqual(declaredPropertyNames(file), []);
    });

    it("still catches the real HEX-030 shapes, at every depth", () => {
      const file = parse(
        "violation.ts",
        [
          "export interface Node {",
          "  id: string;",
          '  extent?: "parent";',
          "  style?: { width?: number; zIndex?: number };",
          "}",
          "export type Edge = {",
          "  className?: string;",
          "  markerEnd?: string;",
          "};",
        ].join("\n"),
      );

      const names = declaredPropertyNames(file);
      assert.deepEqual(names.sort(), [
        "className",
        "extent",
        "id",
        "markerEnd",
        "style",
        "width",
        "zIndex",
      ]);
      assert.deepEqual(
        names.filter((n) => RENDERER_MEMBER_NAMES.has(n)).sort(),
        ["className", "extent", "markerEnd", "style", "zIndex"],
      );
    });

    /**
     * The declaration forms that are not `interface` members. The domain has no
     * class today, so this is the only place these shapes are exercised — which
     * is the point: without it, moving a domain type to a class would carry
     * renderer vocabulary straight past a guard that still reported clean.
     */
    it("catches class properties and constructor parameter properties", () => {
      const file = parse(
        "class-violation.ts",
        [
          "export class Node {",
          "  id!: string;",
          '  extent?: "parent";',
          "  style?: { zIndex?: number };",
          "  constructor(",
          "    public readonly className: string,",
          "    private markerEnd: string,",
          "    notAMember: string,",
          "  ) {",
          "    this.id = className + markerEnd + notAMember;",
          "  }",
          "}",
        ].join("\n"),
      );

      const names = declaredPropertyNames(file);
      assert.deepEqual(names.sort(), [
        "className",
        "extent",
        "id",
        "markerEnd",
        "style",
        "zIndex",
      ]);
      // The plain parameter declares no member and must not be reported.
      assert.ok(!names.includes("notAMember"));
      assert.deepEqual(
        names.filter((n) => RENDERER_MEMBER_NAMES.has(n)).sort(),
        ["className", "extent", "markerEnd", "style", "zIndex"],
      );
    });

    /**
     * `interface X { ["style"]?: … }` compiles, and `keyof X` reads it as
     * `"style"` — so a walk that drops `ComputedPropertyName` reports clean
     * while the field is there. Literal computed names unwrap to the same
     * string as a plain member.
     */
    it("unwraps literal computed member names", () => {
      const { names, unresolvedComputed } = declaredMembers(
        parse(
          "computed.ts",
          [
            "export interface Node {",
            '  ["style"]?: { zIndex?: number };',
            "  [`className`]?: string;",
            "  id: string;",
            "}",
          ].join("\n"),
        ),
      );

      assert.deepEqual(names.sort(), ["className", "id", "style", "zIndex"]);
      assert.deepEqual(unresolvedComputed, []);
    });

    /**
     * And a computed name that syntax cannot resolve is reported rather than
     * dropped, so "spell it as a constant" is not the remaining way through.
     */
    it("reports computed member names it cannot resolve, instead of dropping them", () => {
      const { names, unresolvedComputed } = declaredMembers(
        parse(
          "indirect.ts",
          [
            'const STYLE_KEY = "style";',
            "declare const Tokens: Record<string, string>;",
            "export interface Node {",
            "  [STYLE_KEY]?: { width?: number };",
            "  [Tokens.className]?: string;",
            "  id: string;",
            "}",
          ].join("\n"),
        ),
      );

      // The readable member is still collected; the two indirect ones are not
      // silently lost.
      assert.deepEqual(names.sort(), ["id", "width"]);
      assert.deepEqual(unresolvedComputed.sort(), [
        "[STYLE_KEY]",
        "[Tokens.className]",
      ]);
    });
  });
});
