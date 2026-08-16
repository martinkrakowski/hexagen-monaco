/**
 * HEX-013 / plan item 5.7 — the parser lives behind a DTO port, not in the
 * application layer.
 *
 * WHY THIS EXISTS. `RefactoringImpactUseCase` used to `new Project()` from
 * ts-morph itself and pass live `SourceFile` nodes to
 * `SymbolReferenceProviderPort`. Two separate costs:
 *
 *  - The application layer's dependency arrow pointed at a concrete parser.
 *    `@hexagen/sync` is published; ts-morph bundles its own TypeScript
 *    compiler (AUD-012), so the version of a third-party parser was a
 *    compile-time fact about the use case, not a swappable detail.
 *  - The port itself was typed in ts-morph's vocabulary
 *    (`findReferences(name, sourceFiles: SourceFile[])`), which is a port in
 *    name only: no implementation that is not ts-morph can satisfy it, and
 *    every node handed across the boundary drags the whole object model with
 *    it.
 *
 * WHAT IS PINNED. Two halves, and both matter:
 *
 *  1. NEGATIVE — nothing under `src/application/` or `src/domain/` may name
 *     ts-morph, in any import form (value, type-only, re-export, type-position
 *     `import(...)`, dynamic `await import(...)`). A type-only edge is still a
 *     compile-time layer dependency; see `domain-layer-imports.guard.test.ts`
 *     for the same reasoning applied to the composition root.
 *  2. POSITIVE — `src/infrastructure/` still *does* import ts-morph. Without
 *     this arm the negative one is satisfiable by deleting the parsing
 *     entirely, which would "pass" while destroying the analyser. The
 *     dependency was moved outward, not removed.
 *
 * ANTI-STUB DESIGN. A guard that scans nothing, or whose collector sees
 * nothing, stays green forever. So: discovery is asserted to find the specific
 * modules this item is about, and the collector is exercised against a
 * synthetic file that names ts-morph in all five import forms — if the walk
 * returned an empty list, that control fails first.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const SRC_DIR = path.join(PACKAGE_ROOT, "src");

/** The parser package that must not be visible from the inner layers. */
const PARSER_SPECIFIER = /^ts-morph(\/|$)/;

/** Native separators to POSIX, so globs and report keys share one dialect. */
function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * Every module specifier that escapes a source file, in every syntactic form.
 *
 * Deliberately the same collector shape as `domain-layer-imports.guard.test.ts`:
 * an edge the emitted JavaScript never mentions is still an edge, and the one
 * form that survives a `verbatimModuleSyntax` sweep (`await import(...)`) is
 * exactly the one a future "fix" would reach for to smuggle the parser back in.
 */
function collectModuleSpecifiers(file: SourceFile): string[] {
  const specifiers: string[] = [];

  for (const declaration of [
    ...file.getImportDeclarations(),
    ...file.getExportDeclarations(),
  ]) {
    const value = declaration.getModuleSpecifierValue();
    if (value !== undefined) specifiers.push(value);
  }

  for (const node of file.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const argument = node.getArgument();
    if (!Node.isLiteralTypeNode(argument)) continue;
    const literal = argument.getLiteral();
    if (Node.isStringLiteral(literal))
      specifiers.push(literal.getLiteralValue());
  }

  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [argument] = call.getArguments();
    if (argument && Node.isStringLiteral(argument)) {
      specifiers.push(argument.getLiteralValue());
    }
  }

  return specifiers;
}

function loadSources(globs: string[]): SourceFile[] {
  const project = new Project({
    compilerOptions: { allowJs: false },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  // POSIX separators on purpose: ts-morph globs through fast-glob, which does
  // not treat a backslash as a separator, so a `path.join` glob matches nothing
  // on Windows and the discovery assert would fail for an unrelated reason.
  project.addSourceFilesAtPaths(globs);
  return project.getSourceFiles();
}

function relativeTo(root: string, filePath: string): string {
  return toPosix(path.relative(root, filePath));
}

describe("the TypeScript parser stays behind a port (HEX-013)", () => {
  it("no application or domain module names ts-morph, in any import form", () => {
    const src = toPosix(SRC_DIR);
    const sourceFiles = loadSources([
      `${src}/application/**/*.ts`,
      `${src}/domain/**/*.ts`,
    ]);

    // Discovery anchors: a guard that silently scans zero files is worse than
    // no guard. Anchor on the two modules HEX-013 is actually about.
    assert.ok(
      sourceFiles.length > 10,
      `expected application+domain to hold more than 10 modules, found ${sourceFiles.length} — discovery is broken`,
    );
    for (const anchor of [
      "/application/use-cases/refactoring-impact.use-case.ts",
      "/domain/services/layer-classifier.ts",
    ]) {
      assert.ok(
        sourceFiles.some((f) => f.getFilePath().endsWith(anchor)),
        `discovery did not find ${anchor}, a module this guard was written for`,
      );
    }

    const violations: string[] = [];
    for (const file of sourceFiles) {
      for (const specifier of collectModuleSpecifiers(file)) {
        if (!PARSER_SPECIFIER.test(specifier)) continue;
        violations.push(
          `${relativeTo(PACKAGE_ROOT, file.getFilePath())} imports "${specifier}"`,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `The application and domain layers must not depend on a concrete parser.\n` +
        `A type-only import is still a compile-time layer dependency.\n` +
        `Model what the use case actually needs as a DTO on ` +
        `SymbolReferenceIndexPort and implement it in src/infrastructure/.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });

  // Without this arm, the assertion above is satisfiable by deleting the
  // analyser's parsing outright. The dependency must have moved OUTWARD.
  it("the infrastructure adapter still owns the ts-morph dependency", () => {
    const sourceFiles = loadSources([
      `${toPosix(SRC_DIR)}/infrastructure/**/*.ts`,
    ]);

    const importers = sourceFiles
      .filter((file) =>
        collectModuleSpecifiers(file).some((s) => PARSER_SPECIFIER.test(s)),
      )
      .map((file) => relativeTo(PACKAGE_ROOT, file.getFilePath()));

    assert.deepEqual(
      importers,
      ["src/infrastructure/adapters/ts-morph-symbol-index.adapter.ts"],
      "exactly one infrastructure adapter should own the parser — if this is " +
        "empty the parsing was deleted rather than relocated, and the " +
        "no-ts-morph assertion above proves nothing",
    );
  });

  // The guard is only as good as its collector: prove the walk sees every form
  // an edge can take, so "no violations" means "none present" and not "none
  // looked for".
  it("the collector sees ts-morph in every import form", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const file = project.createSourceFile(
      "smuggler.ts",
      [
        `import { Project } from "ts-morph";`,
        `import type { SourceFile } from "ts-morph";`,
        `export type { SyntaxKind } from "ts-morph";`,
        `type Aliased = import("ts-morph").Node;`,
        `const lazy = await import("ts-morph/dist/index.js");`,
        // Decoys: a neighbouring package name that merely starts the same way,
        // and the parser's name as plain text rather than as an edge.
        `import { nothing } from "ts-morph-lite";`,
        "const note = `see ts-morph docs`;",
        `export { Project, lazy, note };`,
        `export type { Aliased };`,
      ].join("\n"),
    );

    const flagged = collectModuleSpecifiers(file).filter((s) =>
      PARSER_SPECIFIER.test(s),
    );
    assert.deepEqual(flagged.sort(), [
      "ts-morph",
      "ts-morph",
      "ts-morph",
      "ts-morph",
      "ts-morph/dist/index.js",
    ]);
  });
});
