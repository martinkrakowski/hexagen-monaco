import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";

/**
 * Layer guard: nothing under `src/domain/` may depend on the composition root.
 *
 * Why this exists. `src/config.ts` is the composition root of this package —
 * it owns `SyncConfig` (CLI flags, workspace root, the live logger, the
 * mutation journal) and is assembled by `parseArgs`/the engine bootstrap.
 * `src/domain/services/stub-template-resolver.ts` imported `SyncConfig` from
 * it (HEX-038), which points the dependency arrow from the innermost layer at
 * the outermost one — the exact inversion hexagonal architecture exists to
 * prevent. The domain must declare the narrow contract it needs and let the
 * outside satisfy it, not reach outward for a wide runtime type.
 *
 * `import type` does NOT exempt an edge. The import was type-only, so it was
 * erased at runtime and nothing "broke" — that is precisely why it survived a
 * year of review. A compile-time layer dependency is still a layer dependency:
 * it couples the domain's signatures to the composition root's shape, so any
 * change there ripples inward and the domain cannot be consumed without it.
 * This guard therefore reads the parsed import graph, where a type-only import
 * is just an import.
 *
 * Parsed, not grepped: `src/domain/stub-templates.ts` embeds
 * `import type { Result } from '@{scope}/shared'` inside a TEMPLATE STRING for
 * generated projects. A regex scan flags that literal as a real import; the
 * TypeScript parser does not. Guards that cry wolf get deleted, so this one
 * uses ts-morph (already a dependency of this package).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");
const DOMAIN_DIR = path.join(PACKAGE_ROOT, "src", "domain");

/**
 * The only modules outside `src/domain/` the domain may reach for. This is a
 * RATCHET: entries may be removed as edges are inverted, never added to hide a
 * new one. Each is justified, and the extension is dropped so `.js` specifiers
 * and their `.ts`/`index.ts` sources compare equal.
 *
 *  - `src/types/manifest` — the manifest vocabulary. Pure types plus total
 *    pure helpers (`portName`, `resolveScope`); no I/O, no config, no logger.
 *    This is the domain's own language, it just physically lives elsewhere.
 *  - `src/template-engine` — a two-line re-export of `interpolate` from
 *    `@hexagen/shared`. A pure `(template, vars) => { output, warnings }`
 *    function with no ambient dependencies.
 *  - `@hexagen/shared` — the shared kernel. `src/domain/result.ts` re-exports
 *    its `Result` type; the same exemption the manifest-violation fixer grants.
 *  - `src/migration-report` — KNOWN RESIDUAL, not an endorsement.
 *    `src/domain/types.ts` takes a type-only `ReportEntryType` from a module
 *    that itself imports `SyncConfig`, so this is the same class of edge as
 *    HEX-038 one hop further out. Inverting it means moving the audit
 *    vocabulary into the domain and is a separate change with its own call
 *    sites; it is listed here so it stays visible and countable rather than
 *    invisible, and so this guard could be tightened by deleting one line.
 */
const ALLOWED_OUTSIDE_DOMAIN = new Set([
  "src/types/manifest",
  "src/template-engine",
  "@hexagen/shared",
  "src/migration-report",
]);

/** Native path separators to POSIX, so keys and globs compare on one dialect. */
function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** Package-relative, POSIX, extensionless — the comparison key. */
function moduleKey(fromFile: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const relative = toPosix(path.relative(PACKAGE_ROOT, resolved));
  return relative.replace(/\.(js|ts)$/, "").replace(/\/index$/, "");
}

function isInsideDomain(key: string): boolean {
  return key.startsWith("src/domain/") || key === "src/domain";
}

/**
 * Every module specifier that escapes a source file, in any syntactic form.
 *
 * All four forms are collected, because the guard's premise is that an edge the
 * emitted JavaScript never mentions is still an edge:
 *
 *  - `import ... from "x"` / `import type { T } from "x"` — ImportDeclaration.
 *  - `export ... from "x"` — ExportDeclaration (`src/domain/result.ts` re-exports
 *    `Result` this way).
 *  - `import("x").T` in TYPE POSITION — ImportTypeNode. Not hypothetical:
 *    `src/domain/result.ts` writes `import("@hexagen/shared").Result<T, Error>`
 *    as its return type, and a declaration-only walk cannot see it. This is the
 *    same erased-at-runtime shape as HEX-038 itself, so missing it would leave
 *    the guard blind to the exact class of edge it was written to catch.
 *  - `await import("x")` — a CallExpression on the `import` keyword. None today,
 *    but it is the one form that survives a `verbatimModuleSyntax` sweep, so the
 *    ratchet should not have a hole waiting for it.
 *
 * Reading the parsed AST is what keeps this honest in both directions: the
 * template-string `import type { Result } from '@{scope}/shared'` inside
 * `src/domain/stub-templates.ts` is a StringLiteral, never an import node, so
 * widening the walk cannot resurrect that false positive.
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

describe("domain layer imports", () => {
  it("no domain module depends on anything outside the ratcheted allowlist", () => {
    const project = new Project({
      compilerOptions: { allowJs: false },
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
    // POSIX separators on purpose: ts-morph globs through fast-glob, which does
    // not treat a backslash as a path separator, so a `path.join` glob matches
    // nothing on Windows. CI is ubuntu-only, but a local Windows checkout would
    // otherwise trip the discovery assert below for a reason that has nothing to
    // do with the domain layer.
    project.addSourceFilesAtPaths(`${toPosix(DOMAIN_DIR)}/**/*.ts`);
    const sourceFiles = project.getSourceFiles();

    // A guard that silently scans nothing is worse than no guard: it stays
    // green forever. Anchor on the file this item is about.
    assert.ok(
      sourceFiles.length > 5,
      `expected the domain layer to have more than 5 modules, found ${sourceFiles.length} — discovery is broken`,
    );
    assert.ok(
      sourceFiles.some((f) =>
        f.getFilePath().endsWith("/domain/services/stub-template-resolver.ts"),
      ),
      "discovery did not find stub-template-resolver.ts, the module this guard was written for",
    );

    const violations: string[] = [];
    for (const file of sourceFiles) {
      const filePath = file.getFilePath();
      const relativeFile = toPosix(path.relative(PACKAGE_ROOT, filePath));
      // Type-only imports are included on purpose — see the header.
      for (const specifier of collectModuleSpecifiers(file)) {
        const key = moduleKey(filePath, specifier);
        if (isInsideDomain(key)) continue;
        if (ALLOWED_OUTSIDE_DOMAIN.has(key)) continue;
        const note =
          key === "src/config"
            ? " — src/config.ts is the COMPOSITION ROOT (SyncConfig: CLI flags, logger, journal). Declare the narrow input the domain actually needs and have the caller build it."
            : "";
        violations.push(
          `${relativeFile} imports "${specifier}" (${key})${note}`,
        );
      }
    }

    assert.deepEqual(
      violations,
      [],
      `The domain layer must not depend on outer layers.\n` +
        `A type-only import is still a compile-time layer dependency.\n` +
        `Invert the edge (narrow domain-owned input type, caller supplies it) — ` +
        `do NOT widen the allowlist.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });

  // The guard is only as good as its collector. Before widening the allowlist
  // is ever debated, prove the walk actually sees every form an edge can take —
  // and that widening it did not re-break the template-string case the parser
  // was chosen for.
  it("collects every import form, and never a specifier inside a string", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const file = project.createSourceFile(
      "sample.ts",
      [
        `import type { SyncConfig } from "./static-type-only.js";`,
        `import { thing } from "./static-value.js";`,
        `export type { Other } from "./reexport.js";`,
        `type Aliased = import("./type-position.js").Shape;`,
        `const loaded = await import("./dynamic.js");`,
        // The decoy: an import that is text for a generated project, not an
        // edge of this file. `src/domain/stub-templates.ts` really does this.
        "const template = `import type { Result } from './IN-A-TEMPLATE.js';`;",
        `export type { Aliased };`,
        `export { thing, loaded, template };`,
      ].join("\n"),
    );

    assert.deepEqual(collectModuleSpecifiers(file).sort(), [
      "./dynamic.js",
      "./reexport.js",
      "./static-type-only.js",
      "./static-value.js",
      "./type-position.js",
    ]);
  });
});
