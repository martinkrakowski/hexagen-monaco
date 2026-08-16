import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import ts from "typescript";

/**
 * Layer guard: nothing under `src/application/` may perform I/O of its own.
 *
 * Why this exists. `ExportGraphImageUseCase` resolved DOM elements with
 * `document.querySelector`, dynamically imported `html-to-image`, and decoded
 * the resulting data URL through `fetch`/`Blob` — three host capabilities
 * living in the application layer (HEX-015). They now sit behind
 * `GraphImageRendererPort`, and this guard is what keeps them there.
 *
 * Parsed, not grepped. The first version of this guard did
 * `source.includes("document")` on the raw file, which fails on the word in a
 * comment, in a JSDoc `@link`, or inside a string — and passes on
 * `globalThis["doc" + "ument"]`. That is not hypothetical in this repo:
 * `packages/sync/__tests__/domain-layer-imports.guard.test.ts` was moved off a
 * regex for exactly this reason after a template string containing
 * `import type ...` produced a false positive. Guards that cry wolf get
 * deleted, so this one reads the TypeScript AST. `typescript` is already a
 * declared devDependency of this package; no new dependency was added for it.
 *
 * Two rules, both structural:
 *
 *  1. Every module specifier that escapes an application file is relative
 *     (inside the package) or in {@link ALLOWED_PACKAGES}. This is strictly
 *     stronger than banning `html-to-image` by name — it is the
 *     application-layer sibling the arch linter's `npm-package-in-domain` rule
 *     does not have, so *any* library reaching into the layer trips it.
 *  2. No FREE reference to a host global. Identifiers only, so a comment, a
 *     string literal and a property named `document` are all invisible to it —
 *     which is precisely the brittleness the substring scan had.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../..");
const APPLICATION_DIR = path.join(PACKAGE_ROOT, "src", "application");

/**
 * Non-relative specifiers the application layer may import. A RATCHET: entries
 * come off as edges are inverted, and are not added to hide a new one.
 *
 *  - `@hexagen/project-configuration` — a declared workspace dependency
 *    supplying the `WizardData` vocabulary as types only.
 */
const ALLOWED_PACKAGES = new Set(["@hexagen/project-configuration"]);

/**
 * Ambient host capabilities the application layer must reach through a port.
 *
 * `document` / `window` / `navigator` / `localStorage` are the DOM;
 * `fetch` / `XMLHttpRequest` are the network; `Blob` / `File` / `FileReader`
 * are the payload types the pre-port code decoded through. The three the
 * original substring scan named (`document`, `fetch`, `Blob` via `blob()`) are
 * all here; the rest close the obvious neighbours rather than waiting for the
 * next one to be found by review.
 */
const FORBIDDEN_GLOBALS = new Set([
  "document",
  "window",
  "navigator",
  "localStorage",
  "sessionStorage",
  "fetch",
  "XMLHttpRequest",
  "Blob",
  "File",
  "FileReader",
  "require",
  "process",
]);

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
 * Every module specifier that escapes a file, in each syntactic form.
 *
 * All four are collected because an edge the emitted JavaScript never mentions
 * is still an edge — the same reasoning the sync guard records at length:
 * `import`/`export ... from`, `import("x")` in type position, and
 * `await import("x")`, which is the form HEX-015 actually used.
 */
function moduleSpecifiers(file: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return specifiers;
}

/**
 * True when this identifier is a *name* rather than a value reference: the
 * `x` in `obj.x`, in `{ x: 1 }`, in `const x = …`, in `import { x }`, or in a
 * qualified type name. Those are the shapes that made the substring scan noisy,
 * so skipping them is the whole point of parsing.
 */
function isNamePosition(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return true;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return true;
  if (ts.isMethodSignature(parent) && parent.name === node) return true;
  if (ts.isEnumMember(parent) && parent.name === node) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  return false;
}

/** Host globals a file references as values. Never a comment or a string. */
function forbiddenGlobalReferences(file: ts.SourceFile): string[] {
  const hits: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      FORBIDDEN_GLOBALS.has(node.text) &&
      !isNamePosition(node)
    ) {
      hits.push(node.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return hits;
}

describe("the application layer performs no I/O of its own", () => {
  const files = typeScriptFilesUnder(APPLICATION_DIR);

  // A guard that silently scans nothing stays green forever. Anchor on the file
  // this item is about, and on the layer being more than one module.
  it("discovers the application layer it is meant to be scanning", () => {
    assert.ok(
      files.length > 5,
      `expected more than 5 application modules, found ${files.length} — discovery is broken`,
    );
    assert.ok(
      files.some((f) =>
        f.endsWith(path.join("use-cases", "export-graph-image.ts")),
      ),
      "discovery did not find export-graph-image.ts, the module this guard was written for",
    );
  });

  it("imports no npm package outside the ratcheted allowlist", () => {
    const violations: string[] = [];
    for (const filePath of files) {
      const file = parse(filePath, readFileSync(filePath, "utf8"));
      for (const specifier of moduleSpecifiers(file)) {
        if (specifier.startsWith(".")) continue;
        if (ALLOWED_PACKAGES.has(specifier)) continue;
        violations.push(
          `${path.relative(PACKAGE_ROOT, filePath)} imports "${specifier}"`,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `The application layer must reach capability through a driven port.\n` +
        `A dynamic \`await import("html-to-image")\` is what HEX-015 was.\n` +
        `Move the library behind an adapter — do NOT widen the allowlist.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });

  it("references no DOM, network or filesystem global", () => {
    const violations: string[] = [];
    for (const filePath of files) {
      const file = parse(filePath, readFileSync(filePath, "utf8"));
      for (const name of forbiddenGlobalReferences(file)) {
        violations.push(
          `${path.relative(PACKAGE_ROOT, filePath)} references \`${name}\``,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `The application layer must not touch host globals.\n` +
        `\`document\` and \`fetch\` need no import, so no specifier-based linter\n` +
        `rule can see them — this guard is the only thing that does.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });

  /**
   * Attack the guard itself. A boundary check is only worth its line count if
   * it (a) still fires on the violation it was written for and (b) stays quiet
   * on the text that made its substring predecessor unusable.
   */
  describe("the walk itself", () => {
    const DECOY = [
      "// A comment about document.querySelector and fetch( and html-to-image.",
      "/** JSDoc naming {@link document} and Blob and arrayBuffer. */",
      "const selector = \"document.querySelector('.react-flow__viewport')\";",
      'const snippet = `await import("html-to-image")`;',
      "const config = { document: 1, fetch: 2, window: 3 };",
      "const read = config.document + config.fetch;",
      'import type { Result } from "../result.js";',
      "export type { Result };",
      "export { selector, snippet, config, read };",
    ].join("\n");

    it("sees nothing in comments, strings or property names", () => {
      const file = parse("decoy.ts", DECOY);

      assert.deepEqual(forbiddenGlobalReferences(file), []);
      assert.deepEqual(
        moduleSpecifiers(file).filter((s) => !s.startsWith(".")),
        [],
      );
    });

    it("still catches the real HEX-015 shapes", () => {
      const file = parse(
        "violation.ts",
        [
          'const { toPng } = await import("html-to-image");',
          'import { something } from "some-npm-package";',
          'type Late = import("another-package").Shape;',
          "const element = document.querySelector(sel);",
          "const response = await fetch(dataUrl);",
          "export { toPng, something, element, response };",
          "export type { Late };",
        ].join("\n"),
      );

      assert.deepEqual(forbiddenGlobalReferences(file).sort(), [
        "document",
        "fetch",
      ]);
      assert.deepEqual(
        moduleSpecifiers(file)
          .filter((s) => !s.startsWith("."))
          .sort(),
        ["another-package", "html-to-image", "some-npm-package"],
      );
    });
  });
});
