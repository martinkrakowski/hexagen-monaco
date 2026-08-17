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
 * `src/application/ports/in/renderable-graph.ts` — a compile-time assignment in
 * production code asserting the domain and presentation key sets are disjoint.
 * That one is exact but closed: it can only notice the four names the
 * presentation type already declares. This one is open: it fails on renderer
 * vocabulary the split has never seen, e.g. someone adding `hidden`,
 * `selectable` or `measured` to a domain node next year.
 *
 * Parsed, not grepped, for the reason spelled out at length in the application
 * guard: a substring scan matches the word `style` in a comment and misses
 * nothing useful in exchange. This walk reads property *declarations* only —
 * `interface X { style: … }` and `type X = { style: … }` — so a comment, a
 * string literal, a local variable and a function parameter named `style` are
 * all invisible.
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
 * Every property name declared by a type in this file: interface members and
 * the members of inline / aliased object type literals, at any nesting depth
 * (`style?: { zIndex?: number }` must yield both `style` and `zIndex`).
 *
 * `PropertySignature` only. A `PropertyAssignment` — the `document: 1` in an
 * object *value* — is not a type declaration and is not collected, which is
 * what keeps a config literal or a returned object out of the scan.
 */
function declaredPropertyNames(file: ts.SourceFile): string[] {
  const names: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node)) {
      const { name } = node;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        names.push(name.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return names;
}

describe("the domain layer declares no renderer vocabulary", () => {
  const files = typeScriptFilesUnder(DOMAIN_DIR);
  const declarations = files.map((filePath) => ({
    filePath,
    names: declaredPropertyNames(
      parse(filePath, readFileSync(filePath, "utf8")),
    ),
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
        `src/application/ports/in/renderable-graph.ts — or delete it if, like\n` +
        `\`draggable\` and \`markerEnd\`, no renderer actually reads it.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
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
  });
});
