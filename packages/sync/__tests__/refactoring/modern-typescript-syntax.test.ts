/**
 * AUD-012 / plan item 3.4 — the refactoring-impact parser must understand the
 * TypeScript this repo (and its consumers) actually write.
 *
 * WHY THIS EXISTS. `ts-morph` does not use the workspace's `typescript`; it
 * bundles its own compiler inside `@ts-morph/common`. Before this guard,
 * `packages/sync` declared `ts-morph@^22`, which bundles **TypeScript 5.4.2**,
 * while `tools/arch-linter` declared `^27` (TypeScript 5.9.2) and the repo
 * itself compiles on 5.9.3. `@hexagen/sync` is a *published* engine: `hexagen
 * arch refactor` points this analyser at arbitrary consumer workspaces, so a
 * bundled compiler five minors behind the language spec silently mis-parses
 * source it was handed. The failure is quiet — ts-morph error-recovers, so the
 * analyser still returns a plausible-looking report built from a damaged AST.
 *
 * THE DISCRIMINATOR. `import defer * as ns from "..."` (TypeScript 5.9) is the
 * only genuinely new *syntax* between 5.4 and 5.9. Under ts-morph 22 it yields
 * three syntactic diagnostics and the whole `ImportDeclaration` **disappears
 * from the AST**; under 27 it parses clean and the declaration is present.
 * `getImportDeclarations()` is exactly what the adapter's reason ladder and
 * `updateImports()` walk, so a dropped import is a dropped rename.
 *
 * WHERE THE SETTINGS LIVE. `REFACTORING_IMPACT_COMPILER_OPTIONS` moved from the
 * use case to `infrastructure/adapters/ts-morph-symbol-index.adapter.ts` with
 * HEX-013 (item 5.7), which put the parser behind a DTO port. Nothing about
 * this guard's discriminating property changed: it still constructs a `Project`
 * from the *same object production uses*, and the analyser still parses through
 * it. Only the import path moved.
 *
 * HONEST SCOPE. Scanning all 2629 `.ts`/`.tsx` files in this repo with the 5.4.2
 * parser produces zero syntactic diagnostics today, so this alignment fixes a
 * *latent* gap for consumer code rather than a live breakage here. The guard is
 * written so it fails the moment the bundled compiler regresses below 5.5.
 *
 * ANTI-STUB DESIGN. "Zero diagnostics" alone is satisfiable by a parser that
 * reports nothing, so every negative assertion here is paired:
 *   - a broken-syntax control that MUST still produce diagnostics;
 *   - positive structural assertions (import specifiers, interface names, type
 *     references) that a no-op parser cannot manufacture.
 * The project settings come from production via
 * `REFACTORING_IMPACT_COMPILER_OPTIONS`, so the test cannot drift from what the
 * analyser really does.
 *
 * SECOND SUITE. The `workspace-relative paths are POSIX on every host` describe
 * at the bottom is *not* a ts-morph-version discriminator — it passes on 22 and
 * 27 alike. It pins the path dialect the analyser emits, which is what earns
 * the hard-coded POSIX assertions in the liveness arm the right to be
 * hard-coded. See `toWorkspaceRelativePosixPath` in
 * `src/domain/services/layer-classifier.ts` for the input/output dialect
 * mismatch it guards.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import path from "node:path";
import { promises as fs } from "node:fs";
import { Project, SyntaxKind, ts } from "ts-morph";
import { REFACTORING_IMPACT_COMPILER_OPTIONS } from "../../src/infrastructure/adapters/ts-morph-symbol-index.adapter.js";
import { toWorkspaceRelativePosixPath } from "../../src/domain/services/layer-classifier.js";
import { ImpactAnalyzer } from "../../src/refactoring/impact-analyzer.js";
import type { Manifest } from "../../src/types/manifest.js";
import { withTempWorkspace } from "../helpers/fs-helpers.js";

/** A file mixing TS 5.9 `import defer` with ordinary port/adapter shapes. */
const MODERN_SOURCE = [
  `import defer * as heavyAdapter from "./heavy-adapter.js";`,
  `import { OrderRepositoryPort } from "./order-repository.port.js";`,
  ``,
  `export interface OrderQueryPort {`,
  `  findAll(): Promise<readonly string[]>;`,
  `}`,
  ``,
  `export class OrderService {`,
  `  constructor(private readonly repo: OrderRepositoryPort) {}`,
  `  boot() {`,
  `    return heavyAdapter.init(this.repo);`,
  `  }`,
  `}`,
  ``,
].join("\n");

/** Deliberately unparseable — the control that proves diagnostics are real. */
const BROKEN_SOURCE = `export class Broken { constructor( private readonly `;

const MANIFEST: Manifest = {
  version: "2.0",
  system: "orders-system",
  bounded_contexts: [],
} as unknown as Manifest;

async function writeFixture(
  workspaceRoot: string,
  relativePath: string,
  contents: string,
): Promise<string> {
  const absolute = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents, "utf-8");
  return absolute;
}

describe("refactoring-impact parses >=TS 5.5 syntax (AUD-012)", () => {
  it("ships a bundled TypeScript no older than the syntax it must read", () => {
    const [major, minor] = ts.version.split(".").map(Number);
    assert.ok(
      major > 5 || (major === 5 && minor >= 5),
      `ts-morph bundles TypeScript ${ts.version}; the refactoring-impact ` +
        `analyser must bundle >= 5.5 to parse the syntax this repo compiles ` +
        `(TypeScript 5.9.x). Downgrading ts-morph reintroduces AUD-012.`,
    );
  });

  it("parses TS 5.9 `import defer` with the analyser's own project settings", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const modern = await writeFixture(
        workspaceRoot,
        "packages/orders/src/order-service.ts",
        MODERN_SOURCE,
      );

      const project = new Project({ ...REFACTORING_IMPACT_COMPILER_OPTIONS });
      const sourceFile = project.addSourceFileAtPath(modern);

      const diagnostics = project
        .getProgram()
        .compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode);
      assert.deepStrictEqual(
        diagnostics.map((d) =>
          ts.flattenDiagnosticMessageText(d.messageText, "; "),
        ),
        [],
        "modern-but-valid TypeScript must parse without syntactic errors",
      );

      // POSITIVE STRUCTURE — a parser that merely reports nothing cannot
      // produce these. The deferred import is the one ts-morph 22 dropped.
      assert.deepStrictEqual(
        sourceFile
          .getImportDeclarations()
          .map((d) => d.getModuleSpecifierValue()),
        ["./heavy-adapter.js", "./order-repository.port.js"],
        "the `import defer` declaration must survive into the AST — " +
          "getModificationReason() and updateImports() both walk this list",
      );
      assert.deepStrictEqual(
        sourceFile.getInterfaces().map((i) => i.getName()),
        ["OrderQueryPort"],
      );
      assert.deepStrictEqual(
        sourceFile.getClasses().map((c) => c.getName()),
        ["OrderService"],
      );
      assert.ok(
        sourceFile
          .getDescendantsOfKind(SyntaxKind.TypeReference)
          .some((r) => r.getText() === "OrderRepositoryPort"),
        "the port type reference must be reachable by AST traversal",
      );
    });
  });

  it("still reports diagnostics for genuinely broken syntax (anti-stub control)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const broken = await writeFixture(
        workspaceRoot,
        "packages/orders/src/broken.ts",
        BROKEN_SOURCE,
      );

      const project = new Project({ ...REFACTORING_IMPACT_COMPILER_OPTIONS });
      const sourceFile = project.addSourceFileAtPath(broken);
      const diagnostics = project
        .getProgram()
        .compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode);

      assert.ok(
        diagnostics.length > 0,
        "the diagnostics channel must be live — if this passes empty, the " +
          "zero-diagnostics assertion above proves nothing",
      );
    });
  });

  // LIVENESS ARM, NOT A DISCRIMINATOR. This one passes on ts-morph 22 as well:
  // TypeScript error-recovers well enough that the surrounding declarations
  // survive, so `analyze()`'s coarse output (a file list plus a reason string)
  // looks identical either way. That is precisely why the mis-parse was
  // invisible. Kept because it proves the fixture really flows through
  // ImpactAnalyzer -> RefactoringImpactUseCase -> TsMorphSymbolIndexAdapter ->
  // ts-morph rather than through a hand-built Project the production path never
  // touches.
  // RI-2.2 control lives on this liveness arm: a clean parse must not emit
  // a "Could not parse" warning, otherwise a hard-coded warning would
  // satisfy the broken-syntax arm below.
  it("analyses a workspace containing >=TS 5.5 syntax end to end (liveness)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      await writeFixture(
        workspaceRoot,
        "packages/orders/src/order-service.ts",
        MODERN_SOURCE,
      );
      await writeFixture(
        workspaceRoot,
        "packages/orders/src/order-repository.port.ts",
        `export interface OrderRepositoryPort { findAll(): Promise<void>; }\n`,
      );

      const result = await new ImpactAnalyzer(workspaceRoot, MANIFEST).analyze({
        type: "rename-port",
        target: "OrderRepositoryPort",
        newName: "OrderStorePort",
      });

      assert.ok(
        result.success,
        `analyse failed: ${result.success ? "" : String(result.error)}`,
      );
      // POSIX separators are the analyser's contract, not a host assumption —
      // `toWorkspaceRelativePosixPath` normalises both dialects, and the
      // `workspace-relative paths are POSIX on every host` suite below pins
      // that with Windows-shaped inputs.
      const paths = result.value.filesToModify.map((f) => f.path);
      assert.ok(
        paths.includes("packages/orders/src/order-service.ts"),
        `the modern-syntax file must be picked up; got ${JSON.stringify(paths)}`,
      );

      // The declaring file's reason is derived from a real AST walk, so this
      // pins that the analyser read structure and not just raw text.
      const declaring = result.value.filesToModify.find(
        (f) => f.path === "packages/orders/src/order-repository.port.ts",
      );
      assert.strictEqual(
        declaring?.reason,
        "Declares interface OrderRepositoryPort",
      );

      assert.ok(
        !result.value.warnings.some((warning) =>
          /Could not parse/.test(warning),
        ),
        `clean files must not emit a parse warning; got ${JSON.stringify(result.value.warnings)}`,
      );
    });
  });

  it("warns with the named file when the workspace contains unparseable syntax (RI-2.2)", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      await writeFixture(
        workspaceRoot,
        "packages/orders/src/order-repository.port.ts",
        `export interface OrderRepositoryPort { findAll(): Promise<void>; }\n`,
      );
      await writeFixture(
        workspaceRoot,
        "packages/orders/src/broken-port.ts",
        `export class OrderRepositoryPort { constructor( private readonly `,
      );

      const result = await new ImpactAnalyzer(workspaceRoot, MANIFEST).analyze({
        type: "rename-port",
        target: "OrderRepositoryPort",
        newName: "OrderStorePort",
      });

      assert.ok(
        result.success,
        `analyse failed: ${result.success ? "" : String(result.error)}`,
      );
      assert.ok(
        result.value.warnings.some((warning) =>
          /Could not parse packages\/orders\/src\/broken-port\.ts \(syntactic\)/.test(
            warning,
          ),
        ),
        `expected a named-file syntactic warning, got ${JSON.stringify(result.value.warnings)}`,
      );
      assert.ok(
        !result.value.warnings.some((warning) =>
          warning.includes("order-repository.port.ts"),
        ),
        `the clean sibling must not be named as unparseable; got ${JSON.stringify(result.value.warnings)}`,
      );
    });
  });
});

/**
 * NOT A ts-morph DISCRIMINATOR. These arms pass on ts-morph 22 and 27 alike —
 * they pin the *path dialect* of the analyser's output, which is what makes the
 * hard-coded POSIX assertions in the liveness arm above legitimate on every
 * host rather than only on the Linux runner CI happens to use.
 *
 * The two path strings the analyser subtracts arrive in different dialects:
 * `SourceFile.getFilePath()` is a ts-morph *output* and returns a
 * `StandardizedFilePath` (already forward-slashed, even on Windows), while
 * `workspaceRoot` is a raw *input* the caller supplies (native separators). The
 * old `` filePath.replace(`${workspaceRoot}/`, "") `` matched nothing on
 * Windows and leaked the absolute path into `FileToModify.path`.
 */
describe("workspace-relative paths are POSIX on every host", () => {
  it("strips a Windows workspace root from a standardized ts-morph path", () => {
    // Exactly the pair production sees on Windows: a native `os.tmpdir()` /
    // `path.join` root against a ts-morph `StandardizedFilePath`.
    assert.strictEqual(
      toWorkspaceRelativePosixPath(
        "C:\\Users\\ci\\AppData\\Local\\Temp\\hexagen-test-abc",
        "C:/Users/ci/AppData/Local/Temp/hexagen-test-abc/packages/orders/src/order-service.ts",
      ),
      "packages/orders/src/order-service.ts",
      "a backslashed workspace root must still reduce to a POSIX relative " +
        "path — determinePackageName() anchors on /^(?:packages|apps)\\//",
    );
  });

  it("is unchanged on POSIX roots (no regression for the common case)", () => {
    assert.strictEqual(
      toWorkspaceRelativePosixPath(
        "/tmp/hexagen-test-abc",
        "/tmp/hexagen-test-abc/packages/orders/src/order-service.ts",
      ),
      "packages/orders/src/order-service.ts",
    );
  });

  it("tolerates a trailing separator on the workspace root", () => {
    assert.strictEqual(
      toWorkspaceRelativePosixPath("C:\\repo\\", "C:/repo/apps/web/app/x.tsx"),
      "apps/web/app/x.tsx",
    );
  });

  // ANTI-STUB CONTROL. A helper that simply returned its second argument, or
  // that stripped every leading segment unconditionally, would satisfy the
  // assertions above. This one pins that the root really is subtracted rather
  // than guessed: an unrelated root must NOT yield a clean relative path.
  it("does not fabricate a relative path when the root does not contain the file", () => {
    const result = toWorkspaceRelativePosixPath(
      "/tmp/other-workspace",
      "/tmp/hexagen-test-abc/packages/orders/src/order-service.ts",
    );
    assert.notStrictEqual(result, "packages/orders/src/order-service.ts");
    assert.ok(
      result.startsWith("../"),
      `an out-of-tree file must escape upward, got ${JSON.stringify(result)}`,
    );
  });
});
