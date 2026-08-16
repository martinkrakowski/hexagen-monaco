import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * HEX-004 — the application layer of this bounded context must not name the
 * sync CLI package.
 *
 * `@hexagen/sync` is the generator *engine*: this context drives it from
 * `infrastructure/adapters/external-sync-engine.adapter.ts`, and that is the
 * only place allowed to know it exists. Before this guard, the application's
 * ports and use case were typed on `Manifest` imported straight from it, so the
 * generation contracts could not be compiled — or exercised — without the
 * engine. They are typed on the context-owned `GenerationManifest` DTO instead.
 *
 * The check is a source scan rather than a type assertion on purpose: the defect
 * is the *import edge*, and an edge is only observable in the source text. A
 * type test would keep passing the moment someone re-added the import for a
 * different symbol.
 *
 * Parsed, not grepped. The first version of this guard matched specifiers with
 * a regex over the raw text, which is wrong in both directions: it misses
 * ``import(`@hexagen/sync`)`` — a no-substitution template literal is a valid
 * dynamic-import argument — and it fires on the package name written inside a
 * comment or a template string. Neither is hypothetical here:
 * `packages/visualization/__tests__/application/application-layer-io.guard.test.ts`
 * handles the backtick form explicitly, and
 * `packages/sync/__tests__/domain-layer-imports.guard.test.ts` was moved off a
 * regex after a template string containing `import type …` produced a false
 * positive. `typescript` is already a declared devDependency of this package;
 * no new dependency was added for this.
 */
const APPLICATION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/application",
);

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
    return entry.isFile() && full.endsWith(".ts") ? [full] : [];
  });
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
 * Every module specifier that escapes a file, in each syntactic form:
 * `import`/`export … from`, `import("x")` in type position, and dynamic
 * `import("x")` / ``import(`x`)``. An `import type` edge counts — it is erased
 * at runtime, but it still couples this layer's signatures to the engine, which
 * is the whole defect HEX-004 names.
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

describe("HEX-004 — application layer does not depend on @hexagen/sync", () => {
  it("finds application sources to scan (the scan is not vacuous)", () => {
    const files = tsFilesUnder(APPLICATION_DIR);
    // The threshold is not decoration: the layer's modules mostly live in
    // `ports/in`, `ports/out` and `use-cases`, so it sits well above the number
    // of files directly in the directory. A discovery regression that stopped
    // recursing into the subdirectories would still find sources — and would
    // still fail here, which `> 0` could not do.
    assert.ok(
      files.length >= 5,
      `expected the application layer to hold several modules, found ${files.length}`,
    );
    // The scanner must actually see specifiers, or an "everything is clean"
    // verdict would be meaningless.
    const total = files.flatMap(specifiersIn).length;
    assert.ok(total > 0, "scanner extracted no import specifiers at all");
  });

  it("no application module imports @hexagen/sync", () => {
    const offenders = tsFilesUnder(APPLICATION_DIR)
      .map((file) => ({
        file: path.relative(APPLICATION_DIR, file),
        hits: specifiersIn(file).filter(namesTheEngine),
      }))
      .filter(({ hits }) => hits.length > 0);

    assert.deepEqual(
      offenders,
      [],
      `application modules importing the sync engine (or importing a specifier this guard cannot read):\n${offenders
        .map((o) => `  ${o.file} -> ${o.hits.join(", ")}`)
        .join("\n")}`,
    );
  });

  describe("the collector itself", () => {
    it("reads every syntactic form the edge could come back in", () => {
      const file = parse(
        "offender.ts",
        [
          'import { Manifest } from "@hexagen/sync";',
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
          "/** Driven from the adapter; see `@hexagen/sync` for the engine. */",
          '// import { Manifest } from "@hexagen/sync";',
          'const template = `import { Manifest } from "@hexagen/sync";`;',
          'const name = "@hexagen/sync";',
          'import { GenerationManifest } from "../application/generation-manifest.js";',
          "export { template, name, GenerationManifest };",
        ].join("\n"),
      );

      assert.deepEqual(moduleSpecifiers(file).filter(namesTheEngine), []);
    });
  });
});
