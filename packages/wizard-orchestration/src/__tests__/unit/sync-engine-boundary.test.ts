import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * HEX-004 — this bounded context does not depend on the sync CLI package.
 *
 * `wizardToManifest` is a *projection*: wizard answers in, a manifest-shaped
 * plain object out. It emits the generator's dialect but it does not drive the
 * generator, so it has no business naming `@hexagen/sync`. It used to, purely to
 * reach `Manifest["apps"]` for two type positions — an import edge onto a CLI
 * package for the sake of a string union. Those positions are now typed on the
 * context-owned DTO in `application/manifest-app.dto.ts`.
 *
 * Two assertions, because the two failure modes are different:
 *   - the *source scan* catches a re-added import (all workspaces are hoisted
 *     into the root `node_modules`, so a dropped dependency still resolves —
 *     dropping it alone enforces nothing);
 *   - the *manifest check* catches the declaration creeping back, which is what
 *     makes the package graph claim a coupling that does not exist.
 *
 * Parsed, not grepped. The first version of this scan matched specifiers with a
 * regex over the raw text, which is wrong in both directions: it misses
 * ``import(`@hexagen/sync`)`` — a no-substitution template literal is a valid
 * dynamic-import argument — and it fires on the package name written inside a
 * comment or a template string, which is why that version had to exclude this
 * very file from its own scan. The parser has no such problem, so this file is
 * now scanned like any other. Neither failure is hypothetical here:
 * `packages/visualization/__tests__/application/application-layer-io.guard.test.ts`
 * handles the backtick form explicitly, and
 * `packages/sync/__tests__/domain-layer-imports.guard.test.ts` was moved off a
 * regex after a template string containing `import type …` produced a false
 * positive. `typescript` is already a declared devDependency of this package;
 * no new dependency was added for this.
 */
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SRC_DIR = path.join(PACKAGE_ROOT, "src");
const SYNC_PACKAGE = "@hexagen/sync";

/**
 * Stand-in for a dynamic import whose argument is not a literal. A specifier
 * this walk cannot read is not proof that the edge is absent, so it is recorded
 * and fails the assertion below rather than being silently skipped —
 * `import("@hexagen/" + "sync")` must not pass by being unanalysable.
 */
const UNREADABLE_SPECIFIER = "<non-literal dynamic import specifier>";

function tsFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function parse(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Every module specifier that escapes a file, in each syntactic form:
 * `import`/`export … from`, `import("x")` in type position, and dynamic
 * `import("x")` / ``import(`x`)``. An `import type` edge counts — it is erased
 * at runtime, but the two type positions HEX-004 names were type-only and were
 * still a dependency on the engine.
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
      // `isStringLiteral` is false for backticks, so ``import(`@hexagen/sync`)``
      // would otherwise walk straight past.
      specifiers.push(
        argument !== undefined &&
          (ts.isStringLiteral(argument) ||
            ts.isNoSubstitutionTemplateLiteral(argument))
          ? argument.text
          : UNREADABLE_SPECIFIER,
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return specifiers;
}

function specifiersIn(file: string): string[] {
  return moduleSpecifiers(parse(file, fs.readFileSync(file, "utf8")));
}

function namesTheEngine(specifier: string): boolean {
  return (
    specifier === SYNC_PACKAGE ||
    specifier.startsWith(`${SYNC_PACKAGE}/`) ||
    specifier === UNREADABLE_SPECIFIER
  );
}

describe("HEX-004 — wizard-orchestration is independent of @hexagen/sync", () => {
  it("finds sources to scan (the scan is not vacuous)", () => {
    const files = tsFilesUnder(SRC_DIR);
    // The threshold is not decoration: this package keeps a single barrel
    // directly in `src/`, so it sits far above the number of files in the
    // directory itself. A discovery regression that stopped recursing into the
    // subdirectories would still find a source — and would still fail here,
    // which `> 0` could not do.
    assert.ok(
      files.length >= 10,
      `expected the package to hold several modules, found ${files.length}`,
    );
    assert.ok(
      files.flatMap(specifiersIn).length > 0,
      "scanner extracted no import specifiers at all",
    );
  });

  it("no module imports the sync engine", () => {
    const offenders = tsFilesUnder(SRC_DIR)
      .map((file) => ({
        file: path.relative(PACKAGE_ROOT, file),
        hits: specifiersIn(file).filter(namesTheEngine),
      }))
      .filter(({ hits }) => hits.length > 0);

    assert.deepEqual(
      offenders,
      [],
      `modules importing the sync engine (or importing a specifier this guard cannot read):\n${offenders
        .map((o) => `  ${o.file} -> ${o.hits.join(", ")}`)
        .join("\n")}`,
    );
  });

  it("package.json declares no dependency on the sync engine", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;

    const declaredIn = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ].filter((field) => manifest[field]?.[SYNC_PACKAGE] !== undefined);

    assert.deepEqual(
      declaredIn,
      [],
      `${SYNC_PACKAGE} is still declared in: ${declaredIn.join(", ")}`,
    );
  });

  describe("the collector itself", () => {
    it("reads every syntactic form the edge could come back in", () => {
      const file = parse(
        "offender.ts",
        [
          'import type { Manifest } from "@hexagen/sync";',
          'export type { Foo } from "@hexagen/sync/dist/types";',
          'type Late = import("@hexagen/sync").Manifest;',
          'const a = await import("@hexagen/sync");',
          "const b = await import(`@hexagen/sync`);",
          'const c = await import("@hexagen/" + "sync");',
          "export { a, b, c };",
          "export type { Late, Manifest };",
        ].join("\n"),
      );

      // In source order: static import, re-export, type-position import,
      // dynamic string, dynamic backtick, computed (unreadable).
      assert.deepEqual(moduleSpecifiers(file), [
        SYNC_PACKAGE,
        `${SYNC_PACKAGE}/dist/types`,
        SYNC_PACKAGE,
        SYNC_PACKAGE,
        SYNC_PACKAGE,
        UNREADABLE_SPECIFIER,
      ]);
      // And every one of them fails the rule — the backtick and the computed
      // specifier included, which is what the regex scan let through.
      assert.equal(moduleSpecifiers(file).filter(namesTheEngine).length, 6);
    });

    it("does not fire on the package name in prose or in a string", () => {
      const file = parse(
        "innocent.ts",
        [
          "/** The projection emits the dialect of `@hexagen/sync`, nothing more. */",
          '// import { Manifest } from "@hexagen/sync";',
          'const template = `import { Manifest } from "@hexagen/sync";`;',
          'const name = "@hexagen/sync";',
          'import type { ManifestAppEntry } from "../manifest-app.dto.js";',
          "export { template, name };",
          "export type { ManifestAppEntry };",
        ].join("\n"),
      );

      assert.deepEqual(moduleSpecifiers(file).filter(namesTheEngine), []);
    });
  });
});
