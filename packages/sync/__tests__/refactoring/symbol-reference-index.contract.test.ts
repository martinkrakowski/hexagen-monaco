/**
 * HEX-013 / plan item 5.7 — the `SymbolReferenceIndexPort` contract, from both
 * sides of the boundary.
 *
 * The refactor that introduced this port is behaviour-preserving by intent:
 * `@hexagen/sync` is published and `hexagen arch refactor` runs this analyser
 * against consumer workspaces, so "the report is unchanged" is the whole
 * acceptance criterion. Before the refactor NOTHING pinned the reason strings —
 * `getModificationReason` lived as a private class in `impact-analyzer.ts` with
 * no test of its own, and the only end-to-end arm asserted a single branch of
 * seven. Moving untested logic is how logic quietly changes, so this suite
 * pins the contract on both halves:
 *
 *  - ADAPTER SIDE: the ts-morph implementation, over real files on disk, for
 *    every reason branch AND their precedence order (a file can be several of
 *    these at once; the first match wins and always did).
 *  - USE-CASE SIDE: the use case is driven with a hand-written fake port. That
 *    is what proves the DTO boundary is real — the fake imports no parser, and
 *    if the use case still parsed anything itself the sentinel reasons below
 *    could not appear in its output.
 *
 * ANTI-STUB DESIGN. "The port is called" is satisfiable by a port that returns
 * `[]`; so is "the analyser did not crash". Every arm here therefore asserts
 * *content the stub cannot manufacture*: specific reason strings for specific
 * files, and an explicit "stub control" arm records what a port returning no
 * DTOs yields, so the difference is visible rather than assumed.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { promises as fs } from "node:fs";
import { TsMorphSymbolIndexAdapter } from "../../src/infrastructure/adapters/ts-morph-symbol-index.adapter.js";
import type {
  SymbolReferenceDto,
  SymbolReferenceIndexPort,
} from "../../src/application/ports/out/symbol-reference-index.port.js";
import type {
  WorkspaceFileInfo,
  WorkspaceFileProviderPort,
} from "../../src/application/ports/out/workspace-file-provider.port.js";
import { RefactoringImpactUseCase } from "../../src/application/use-cases/refactoring-impact.use-case.js";
import type { Manifest } from "../../src/types/manifest.js";
import { withTempWorkspace } from "../helpers/fs-helpers.js";

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

/** Index a set of `{ relativePath: source }` fixtures and query one symbol. */
async function indexAndQuery(
  workspaceRoot: string,
  files: Record<string, string>,
  symbolName: string,
): Promise<readonly SymbolReferenceDto[]> {
  const paths: string[] = [];
  for (const [relativePath, contents] of Object.entries(files)) {
    paths.push(await writeFixture(workspaceRoot, relativePath, contents));
  }
  const adapter = new TsMorphSymbolIndexAdapter();
  adapter.indexFiles(paths);
  return adapter.findReferences(symbolName);
}

/** `{ absolutePath -> reason }`, so assertions read independently of order. */
function reasonsByBasename(
  references: readonly SymbolReferenceDto[],
): Record<string, string> {
  return Object.fromEntries(
    references.map((ref) => [path.posix.basename(ref.filePath), ref.reason]),
  );
}

describe("TsMorphSymbolIndexAdapter satisfies SymbolReferenceIndexPort", () => {
  it("reports one reason per reference kind, from a real AST walk", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const references = await indexAndQuery(
        workspaceRoot,
        {
          "packages/orders/src/declares-interface.ts": `export interface OrderRepositoryPort { findAll(): Promise<void>; }\n`,
          "packages/orders/src/declares-class.ts": `export class OrderRepositoryPort {}\n`,
          "packages/orders/src/declares-type.ts": `export type OrderRepositoryPort = { findAll(): void };\n`,
          "packages/orders/src/imports.ts": `import { OrderRepositoryPort } from "./declares-interface.js";\nexport const x = 1;\n`,
          "packages/orders/src/exports.ts": `export { OrderRepositoryPort } from "./declares-interface.js";\n`,
          // A bare type reference with no import of its own — the last rung of
          // the ladder before the generic fallback.
          "packages/orders/src/references-type.ts": `export function boot(repo: OrderRepositoryPort) { return repo; }\n`,
          "packages/orders/src/mentions-in-a-comment.ts": `// OrderRepositoryPort is discussed here but never used.\nexport const y = 2;\n`,
          "packages/orders/src/unrelated.ts": `export const z = 3;\n`,
        },
        "OrderRepositoryPort",
      );

      assert.deepEqual(reasonsByBasename(references), {
        "declares-interface.ts": "Declares interface OrderRepositoryPort",
        "declares-class.ts": "Declares class OrderRepositoryPort",
        "declares-type.ts": "Declares type OrderRepositoryPort",
        "imports.ts": "Imports OrderRepositoryPort",
        "exports.ts": "Exports OrderRepositoryPort",
        "references-type.ts": "References type OrderRepositoryPort",
        "mentions-in-a-comment.ts": "Contains reference to OrderRepositoryPort",
      });

      // The unrelated file must be ABSENT, not merely reason-less: the port's
      // job is to answer "which files", and a stub that returned every indexed
      // file with a filler reason would pass a reasons-only assertion.
      assert.ok(
        !references.some((r) => r.filePath.endsWith("/unrelated.ts")),
        `a file that never names the symbol must not be reported; got ${JSON.stringify(references.map((r) => r.filePath))}`,
      );
    });
  });

  it("keeps the pre-refactor precedence when a file is several things at once", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      // Declaration beats import beats export beats bare type reference. This
      // ordering is not a design choice made here — it is the order the
      // pre-refactor `DefaultSymbolReferenceProvider` walked, and the analyser
      // is published, so it is contract.
      const references = await indexAndQuery(
        workspaceRoot,
        {
          "packages/orders/src/all-at-once.ts": [
            `import { OrderRepositoryPort } from "./other.js";`,
            `export { OrderRepositoryPort };`,
            `export interface OrderRepositoryPort { findAll(): Promise<void>; }`,
            ``,
          ].join("\n"),
          "packages/orders/src/import-and-reference.ts": [
            `import { OrderRepositoryPort } from "./other.js";`,
            `export function boot(repo: OrderRepositoryPort) { return repo; }`,
            ``,
          ].join("\n"),
        },
        "OrderRepositoryPort",
      );

      assert.deepEqual(reasonsByBasename(references), {
        "all-at-once.ts": "Declares interface OrderRepositoryPort",
        "import-and-reference.ts": "Imports OrderRepositoryPort",
      });
    });
  });

  it("emits absolute POSIX-separated paths, on every host", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const references = await indexAndQuery(
        workspaceRoot,
        {
          "packages/orders/src/order-service.ts": `export class OrderService {}\n`,
        },
        "OrderService",
      );

      const [only] = references;
      assert.equal(references.length, 1);
      // `toWorkspaceRelativePosixPath` subtracts a native workspace root from
      // this string (AUD-012). Pinning the dialect here is what lets that
      // helper stay pure segment arithmetic instead of guessing.
      assert.ok(
        !only.filePath.includes("\\"),
        `DTO paths must be slash-separated, got ${only.filePath}`,
      );
      assert.ok(
        only.filePath.endsWith("/packages/orders/src/order-service.ts"),
        `DTO paths must be absolute, got ${only.filePath}`,
      );
    });
  });

  it("accumulates across indexFiles calls, as the analyser's load loop does", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const first = await writeFixture(
        workspaceRoot,
        "packages/orders/src/a.ts",
        `export interface Widget { id: string }\n`,
      );
      const second = await writeFixture(
        workspaceRoot,
        "apps/web/src/b.ts",
        `import type { Widget } from "@orders/a.js";\nexport type B = Widget;\n`,
      );

      const adapter = new TsMorphSymbolIndexAdapter();
      adapter.indexFiles([first]);
      adapter.indexFiles([second]);

      assert.deepEqual(
        adapter
          .findReferences("Widget")
          .map((r) => path.posix.basename(r.filePath))
          .sort(),
        ["a.ts", "b.ts"],
        "the use case walks packages and apps in separate passes — a port " +
          "that forgot the first pass would silently halve every report",
      );
    });
  });
});

/**
 * An in-memory `WorkspaceFileProviderPort` over `{ path -> isDirectory }`, so
 * the use case's own enumeration (which stays in the application layer, since
 * it is pure string work) can be driven without touching a disk.
 */
class FakeWorkspaceFileProvider implements WorkspaceFileProviderPort {
  constructor(
    private readonly workspaceRoot: string,
    private readonly tree: Record<string, string[]>,
    private readonly packages: string[],
    private readonly apps: string[],
  ) {}

  listPackages(): string[] {
    return this.packages;
  }

  listApps(): string[] {
    return this.apps;
  }

  getSourceFiles(dir: string): WorkspaceFileInfo[] {
    return (this.tree[dir] ?? []).map((name) => ({
      path: `${dir}/${name}`,
      isDirectory: this.tree[`${dir}/${name}`] !== undefined,
    }));
  }

  fileExists(filePath: string): boolean {
    // The use case only ever probes directories here (the four load roots).
    return this.tree[filePath] !== undefined;
  }

  readFile(): string | null {
    return null;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}

/** Records what it was handed; answers with whatever it was constructed with. */
class RecordingSymbolIndex implements SymbolReferenceIndexPort {
  readonly indexed: string[] = [];
  readonly queried: string[] = [];

  constructor(private readonly answers: readonly SymbolReferenceDto[] = []) {}

  indexFiles(filePaths: readonly string[]): void {
    this.indexed.push(...filePaths);
  }

  findReferences(symbolName: string): readonly SymbolReferenceDto[] {
    this.queried.push(symbolName);
    return this.answers;
  }
}

const ROOT = "/ws";

function buildUseCase(
  index: SymbolReferenceIndexPort,
): RefactoringImpactUseCase {
  const fileProvider = new FakeWorkspaceFileProvider(
    ROOT,
    {
      [`${ROOT}/packages/orders/src`]: [
        "order-service.ts",
        "order.types.d.ts",
        "notes.md",
        "nested",
        "node_modules",
      ],
      [`${ROOT}/packages/orders/src/nested`]: ["deep.tsx"],
      [`${ROOT}/packages/orders/src/node_modules`]: ["vendored.ts"],
      [`${ROOT}/packages/orders/__tests__`]: ["order-service.test.ts"],
      [`${ROOT}/apps/web/app`]: ["page.tsx", "dist"],
      [`${ROOT}/apps/web/app/dist`]: ["bundle.ts"],
    },
    ["orders"],
    ["web"],
  );
  return new RefactoringImpactUseCase(ROOT, MANIFEST, fileProvider, index);
}

describe("RefactoringImpactUseCase consumes the port's DTOs", () => {
  it("hands the port every parseable source file and nothing else", async () => {
    const index = new RecordingSymbolIndex();
    const result = await buildUseCase(index).analyze({
      type: "rename-port",
      target: "OrderRepositoryPort",
      newName: "OrderStorePort",
    });

    assert.ok(
      result.success,
      `analyse failed: ${result.success ? "" : String(result.error)}`,
    );
    assert.deepEqual(index.indexed.sort(), [
      `${ROOT}/apps/web/app/page.tsx`,
      `${ROOT}/packages/orders/__tests__/order-service.test.ts`,
      `${ROOT}/packages/orders/src/nested/deep.tsx`,
      `${ROOT}/packages/orders/src/order-service.ts`,
    ]);
    // Declaration files, non-TypeScript files, vendored trees and build output
    // are excluded by the use case, not by the parser — that filtering is
    // pure string work and stays on this side of the boundary.
    assert.deepEqual(index.queried, ["OrderRepositoryPort"]);
  });

  it("classifies whatever the port reports, without re-reading any file", async () => {
    // Sentinel reasons no parser would ever produce: if the use case had kept
    // a parser of its own, these could not reach the output.
    const index = new RecordingSymbolIndex([
      {
        filePath: `${ROOT}/packages/orders/src/domain/order.ts`,
        reason: "sentinel-domain-reason",
      },
      {
        filePath: `${ROOT}/apps/web/app/page.tsx`,
        reason: "sentinel-app-reason",
      },
    ]);

    const result = await buildUseCase(index).analyze({
      type: "rename-port",
      target: "OrderRepositoryPort",
      newName: "OrderStorePort",
    });

    assert.ok(
      result.success,
      `analyse failed: ${result.success ? "" : String(result.error)}`,
    );
    assert.deepEqual(result.value.filesToModify, [
      {
        path: "packages/orders/src/domain/order.ts",
        reason: "sentinel-domain-reason",
        layer: "domain",
        packageName: "orders",
      },
      {
        path: "apps/web/app/page.tsx",
        reason: "sentinel-app-reason",
        layer: "unknown",
        packageName: "web",
      },
    ]);
    // Two packages in one report is a cross-package dependency, derived from
    // the DTOs alone.
    assert.deepEqual(result.value.crossPackageDeps, [
      {
        fromPackage: "orders",
        toPackage: "web",
        symbol: "OrderRepositoryPort",
        fromFile: "packages/orders/src/domain/order.ts",
        toFile: "apps/web/app/page.tsx",
      },
    ]);
    assert.equal(result.value.estimatedChanges, 6);
    assert.ok(
      result.value.warnings.some((w) => w.includes("domain layer files")),
      `expected a domain-risk warning, got ${JSON.stringify(result.value.warnings)}`,
    );
  });

  // The control that makes the arm above mean something. A port returning no
  // DTOs must produce a visibly EMPTY report — so if the assertions above ever
  // start passing against a stub, this one has to have changed too.
  it("reports nothing when the port finds nothing (stub control)", async () => {
    const result = await buildUseCase(new RecordingSymbolIndex([])).analyze({
      type: "rename-port",
      target: "OrderRepositoryPort",
      newName: "OrderStorePort",
    });

    assert.ok(
      result.success,
      `analyse failed: ${result.success ? "" : String(result.error)}`,
    );
    assert.deepEqual(result.value.filesToModify, []);
    assert.deepEqual(result.value.crossPackageDeps, []);
    assert.equal(result.value.estimatedChanges, 0);
    assert.deepEqual(result.value.warnings, []);
  });

  it("surfaces a port failure as an error Result rather than a confident report", async () => {
    const exploding: SymbolReferenceIndexPort = {
      indexFiles(): void {
        throw new Error("cannot read source file");
      },
      findReferences(): readonly SymbolReferenceDto[] {
        return [];
      },
    };

    const result = await buildUseCase(exploding).analyze({
      type: "rename-port",
      target: "OrderRepositoryPort",
      newName: "OrderStorePort",
    });

    assert.equal(result.success, false);
    assert.match(
      result.success ? "" : String(result.error),
      /cannot read source file/,
    );
  });
});
