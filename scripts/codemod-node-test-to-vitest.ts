/**
 * Codemod: migrate a package's tests from `node:test` to Vitest (ADR-0044).
 *
 * Usage:
 *   yarn tsx scripts/codemod-node-test-to-vitest.ts <packageDir> [<packageDir> ...]
 *   yarn tsx scripts/codemod-node-test-to-vitest.ts packages/byok
 *
 * Per `*.test.ts` that imports from `node:test`, it performs ONLY the safe,
 * mechanical transforms:
 *   - import source `"node:test"` → `"vitest"`
 *   - hook renames `before` → `beforeAll`, `after` → `afterAll` (import
 *     specifier AND call sites; `beforeEach`/`afterEach` keep their names)
 * `assert.*` is left untouched — it is runner-agnostic (ADR-0044), so we do not
 * rewrite assertions.
 *
 * Files that use the `node:test` mock API (`mock.fn`/`mock.method`/`mock.module`)
 * or a test-context (`t.mock`) are NOT transformed — the `vi.*` equivalents
 * differ in shape (e.g. `calls[i].arguments[j]` → `calls[i][j]`) and need a human.
 * They are reported as "manual".
 *
 * A package's `vitest.config.ts` (re-exporting the shared base) is written and
 * its `package.json` `test` script flipped to `vitest run` ONLY when the package
 * has no remaining `node:test` importers — so a half-migrated package keeps
 * running on `node:test` and the suite stays green (coexistence).
 */
/* eslint-disable no-console -- this is a CLI codemod; console is its reporting channel */
import { Project, SyntaxKind, Node, type SourceFile } from "ts-morph";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const HOOK_RENAMES: Record<string, string> = {
  before: "beforeAll",
  after: "afterAll",
};

/** A file needs a human if it uses the node:test mock API or a test context. */
function needsManualConversion(
  sf: SourceFile,
  named: ReturnType<SourceFile["getImportDeclaration"]>,
): boolean {
  const text = sf.getFullText();
  if (/\bmock\.(fn|method|module|timers|reset)\b/.test(text)) return true;
  if (/\bt\.mock\b/.test(text)) return true;
  return Boolean(named?.getNamedImports().some((n) => n.getName() === "mock"));
}

type FileOutcome = "transformed" | "manual" | "skip";

function transformFile(sf: SourceFile): FileOutcome {
  const importDecl = sf.getImportDeclaration(
    (d) => d.getModuleSpecifierValue() === "node:test",
  );
  if (!importDecl) return "skip";
  if (needsManualConversion(sf, importDecl)) return "manual";

  // `node:test`'s DEFAULT export is the `test` function, so `import test from
  // "node:test"` is valid. Vitest has no default export — `test` is a NAMED
  // export. Rewrite the default import to a named one (preserving any alias)
  // before swapping the source, or the file fails to load under vitest
  // (`default is not a function`).
  const defaultImport = importDecl.getDefaultImport();
  if (defaultImport) {
    const localName = defaultImport.getText();
    importDecl.removeDefaultImport();
    importDecl.addNamedImport(
      localName === "test" ? "test" : { name: "test", alias: localName },
    );
  }

  importDecl.setModuleSpecifier("vitest");
  for (const spec of importDecl.getNamedImports()) {
    const renamed = HOOK_RENAMES[spec.getName()];
    if (renamed) spec.setName(renamed);
  }

  // Rename hook CALL SITES (the import specifier is already renamed above, so it
  // is excluded here). AST-scoped to call callees, so strings/comments and any
  // unrelated identifier are never touched.
  const callees = sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => {
      if (!HOOK_RENAMES[id.getText()]) return false;
      const parent = id.getParent();
      return Node.isCallExpression(parent) && parent.getExpression() === id;
    })
    // Replace last-to-first so earlier nodes' positions stay valid.
    .sort((a, b) => b.getStart() - a.getStart());
  for (const id of callees) id.replaceWithText(HOOK_RENAMES[id.getText()]);

  return "transformed";
}

function writeVitestConfig(packageDir: string): boolean {
  const configPath = join(packageDir, "vitest.config.ts");
  if (existsSync(configPath)) return false;
  // packages/* and apps/* are both two levels below the repo root.
  writeFileSync(
    configPath,
    "// Re-exports the shared Vitest base (ADR-0044). See ../../vitest.shared.ts.\n" +
      'export { default } from "../../vitest.shared";\n',
  );
  return true;
}

function readTestScript(packageDir: string): string | undefined {
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts?.test;
}

function flipTestScript(packageDir: string): boolean {
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  if (!pkg.scripts || pkg.scripts.test === "vitest run") return false;
  pkg.scripts.test = "vitest run";
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return true;
}

function main(): void {
  const packageDirs = process.argv.slice(2);
  if (packageDirs.length === 0) {
    console.error(
      "usage: tsx scripts/codemod-node-test-to-vitest.ts <packageDir> [...]",
    );
    process.exit(1);
  }

  let totalTransformed = 0;
  const allManual: string[] = [];

  for (const dir of packageDirs) {
    // A `… || true` test script hides pre-existing failures. Flipping it to a
    // bare `vitest run` would unmask them, and converting its files WITHOUT
    // flipping would silently drop the tests (the imports would no longer match
    // the node:test runner). Either way that's a deliberate decision, not an
    // automated batch — skip and report.
    const existingTest = readTestScript(dir);
    if (existingTest && /\|\|\s*true/.test(existingTest)) {
      console.log(
        `${dir}: SKIPPED — test script is muffled with \`|| true\`. ` +
          `Migrate deliberately (it will unmask pre-existing failures).`,
      );
      continue;
    }

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const files = project.addSourceFilesAtPaths([
      `${dir}/**/*.test.ts`,
      `!${dir}/**/node_modules/**`,
      `!${dir}/**/dist/**`,
      // Scaffold DATA: a package-root `templates/` holds `.test.ts` files that
      // are *content* generated projects receive, not this package's own tests.
      // Anchored (not `**/templates/**`) so real tests under `__tests__/templates/`
      // are still converted. The shared base also excludes this dir from runs.
      `!${dir}/templates/**`,
    ]);

    let transformed = 0;
    const manual: string[] = [];
    for (const sf of files) {
      const outcome = transformFile(sf);
      if (outcome === "transformed") transformed++;
      else if (outcome === "manual")
        manual.push(relative(process.cwd(), sf.getFilePath()));
    }
    project.saveSync();

    // Flip the package over once no file is left on node:test — i.e. nothing was
    // deferred as manual. Gated on `files.length` (not `transformed`) so a re-run
    // AFTER the manual files are hand-converted still completes the flip (that
    // run transforms 0 but now has 0 manual). Idempotent: config-write and
    // script-flip both no-op if already done.
    let flipped = false;
    if (manual.length === 0 && files.length > 0) {
      const wroteConfig = writeVitestConfig(dir);
      const flippedScript = flipTestScript(dir);
      flipped = wroteConfig || flippedScript;
    }

    totalTransformed += transformed;
    allManual.push(...manual);
    console.log(
      `${dir}: transformed ${transformed}, manual ${manual.length}` +
        (flipped ? ", flipped → vitest run" : "") +
        (manual.length > 0 ? " (script left on node:test)" : ""),
    );
    for (const m of manual) console.log(`    manual: ${m}`);
  }

  console.log(
    `\nDone. ${totalTransformed} file(s) transformed, ${allManual.length} need manual conversion.`,
  );
}

main();
