import assert from "node:assert";
import { describe, it, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import type { SyncFlags, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";

/**
 * Integration tests for ADR-0024 Phase 1.5:
 *   Verify the sync engine is deterministic — running sync twice against the
 *   same manifest produces byte-identical output on the second run.
 *
 * These tests are hermetic: they build a minimal fake monorepo in an OS temp
 * directory and drive `SyncEngine` against that fixture via
 * `SyncEngineOptions`. The real repo tree is NEVER touched.
 *
 * Mode is always `external`, which causes the engine to skip:
 *   - git cleanliness check (sync-engine.ts:306-310)
 *   - preflight dependency build (sync-engine.ts:338-343)
 *   - lockfile acquisition (sync-engine.ts:323-336)
 *   - arch-linter run + migration report write (sync-engine.ts:349-354)
 *
 * `allowDirty: true` is additionally set as belt-and-suspenders in case
 * future refactors relax the external-mode short-circuit.
 */

// -----------------------------------------------------------------------------
// Helpers (not exported — scoped to this test file)
// -----------------------------------------------------------------------------

/** No-op logger that satisfies LoggerPort without polluting test output. */
const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

/** Build a minimal SyncFlags suitable for driving SyncEngine in external mode. */
function makeFlags(): SyncFlags {
  return {
    dryRun: false,
    force: false,
    forceRoot: false,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger: silentLogger,
  };
}

/**
 * Canonical workspace-level tsconfig template — mirrors the real manifest's
 * `workspaceDefaults.tsConfig` at .architecture/manifest.yaml:58-76.
 */
const WORKSPACE_TSCONFIG = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: true,
    composite: true,
    tsBuildInfoFile: "./dist/tsconfig.tsbuildinfo",
    paths: {},
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist", ".turbo"],
  references: [] as Array<{ path: string }>,
};

/** generator.sync.layers template used by ensureLayerFolders to scaffold src/. */
const LAYERS_TEMPLATE = {
  domain: { folder: "src/domain" },
  application: {
    folder: "src/application",
    subfolders: ["ports/in", "ports/out", "use-cases"],
  },
  infrastructure: {
    folder: "src/infrastructure",
    subfolders: ["adapters"],
  },
};

const PROTECTED_KEYS = [
  "private",
  "version",
  "license",
  "scripts",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "main",
  "module",
  "types",
  "exports",
  "bin",
];

/**
 * Build a minimal fixture monorepo in a fresh temp directory.
 *
 * Layout:
 *   <tmp>/package.json             (workspaces: ["packages/*"])
 *   <tmp>/tsconfig.base.json       (empty — generator only refs it)
 *   <tmp>/packages/<name>/         (one empty dir per bounded context)
 *
 * The `.architecture/manifest.yaml` is NOT written to disk — the test passes
 * the manifest via `SyncEngineOptions.manifest`, which short-circuits the
 * file load at sync-engine.ts:80-83.
 *
 * @returns the fixture root path. Caller is responsible for cleanup.
 */
async function createFixture(boundedContextNames: string[]): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-sync-idempotency-"),
  );

  // Minimal root package.json (not strictly required because targetRoot is
  // passed explicitly, but the generator/linter ecosystem expects a workspace
  // root — cheap insurance against future coupling).
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "fixture-monorepo",
        private: true,
        workspaces: ["packages/*"],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  // Minimal tsconfig.base.json. The generator writes `extends: "../../tsconfig.base.json"`
  // into each package tsconfig.json but never reads this file itself; however
  // downstream tooling expects it to exist.
  await fs.writeFile(
    path.join(root, "tsconfig.base.json"),
    JSON.stringify({}, null, 2) + "\n",
    "utf8",
  );

  // Pre-create bare package directories (SyncEngine expects them to exist).
  for (const name of boundedContextNames) {
    await fs.mkdir(path.join(root, "packages", name), { recursive: true });
  }

  return root;
}

/**
 * Remove a fixture directory. Swallows ENOENT so afterEach cleanup is always
 * safe to call, even if a prior cleanup already ran.
 */
async function removeFixture(root: string | null): Promise<void> {
  if (!root) return;
  await fs.rm(root, { recursive: true, force: true });
}

/** File snapshot entry: relative path + sha-256 content hash. */
interface FileSnapshot {
  relPath: string;
  sha256: string;
}

/**
 * Recursively walk `root` and produce a deterministic snapshot of every file.
 *
 *   - `relPath` is POSIX-normalized (forward slashes) and relative to `root`
 *     so snapshots are platform-stable.
 *   - Entries are sorted by `relPath` so deepStrictEqual comparison is
 *     order-independent.
 *   - Directories are NOT included (only files). Empty directories therefore
 *     do not affect the snapshot, which is intentional: the idempotency
 *     contract is about file content, not about ephemeral empty scaffolding.
 *   - node_modules / .git / .turbo / dist are skipped defensively in case the
 *     test environment somehow creates them.
 */
async function snapshotTree(root: string): Promise<FileSnapshot[]> {
  const results: FileSnapshot[] = [];
  const skip = new Set(["node_modules", ".git", ".turbo", "dist"]);

  async function walk(currentDir: string, relDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const absPath = path.join(currentDir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
      } else if (entry.isFile()) {
        const content = await fs.readFile(absPath);
        const sha256 = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");
        results.push({ relPath, sha256 });
      }
      // symlinks / sockets / etc. intentionally ignored
    }
  }

  await walk(root, "");
  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("SyncEngine idempotency (ADR-0024 Phase 1.5)", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("sync engine is idempotent on a minimal fixture", async () => {
    fixtureRoot = await createFixture(["alpha", "shared"]);

    const manifest: Manifest = {
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
        },
      },
      bounded_contexts: [
        { name: "shared", type: "shared-kernel" },
        { name: "alpha", type: "core", depends_on: ["shared"] },
      ],
    };

    const engine = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });

    // First run — scaffolds the fixture.
    await engine.run();
    const first = await snapshotTree(fixtureRoot);

    // Second run — must be a no-op on disk.
    const engine2 = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine2.run();
    const second = await snapshotTree(fixtureRoot);

    assert.deepStrictEqual(
      second,
      first,
      "second sync run must produce a byte-identical file tree",
    );
  });

  it("sync engine is idempotent on a fixture with per-context generator.tsConfig override", async () => {
    fixtureRoot = await createFixture(["beta", "shared"]);

    const manifest: Manifest = {
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
        },
      },
      bounded_contexts: [
        { name: "shared", type: "shared-kernel" },
        {
          // Exercise the Phase 2 three-level merge cascade: per-context
          // generator.tsConfig override > workspaceDefaults.tsConfig >
          // built-in fallback. A non-trivial override (jsx + disabling
          // emitDeclarationOnly) ensures the merge path actually runs.
          name: "beta",
          type: "core",
          depends_on: ["shared"],
          generator: {
            tsConfig: {
              compilerOptions: {
                emitDeclarationOnly: false,
                jsx: "react-jsx",
              },
            },
          },
        },
      ],
    };

    const engine = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();
    const first = await snapshotTree(fixtureRoot);

    const engine2 = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine2.run();
    const second = await snapshotTree(fixtureRoot);

    assert.deepStrictEqual(
      second,
      first,
      "second run must be byte-identical even with per-context tsConfig override",
    );

    // Sanity check: verify the override was actually applied on disk, so
    // this test really does exercise the merge cascade rather than silently
    // falling through to the default template.
    const betaTsconfigRaw = await fs.readFile(
      path.join(fixtureRoot, "packages", "beta", "tsconfig.json"),
      "utf8",
    );
    const betaTsconfig = JSON.parse(betaTsconfigRaw) as {
      compilerOptions: Record<string, unknown>;
    };
    assert.strictEqual(
      betaTsconfig.compilerOptions.jsx,
      "react-jsx",
      "per-context jsx override must be present in generated tsconfig",
    );
    assert.strictEqual(
      betaTsconfig.compilerOptions.emitDeclarationOnly,
      false,
      "per-context emitDeclarationOnly override must be present",
    );
  });

  it("sync engine creates the expected artifacts on first run", async () => {
    fixtureRoot = await createFixture(["alpha", "shared"]);

    const manifest: Manifest = {
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
        },
      },
      bounded_contexts: [
        { name: "shared", type: "shared-kernel" },
        { name: "alpha", type: "core", depends_on: ["shared"] },
      ],
    };

    const engine = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();

    const expectedFiles = [
      "packages/alpha/package.json",
      "packages/alpha/tsconfig.json",
      "packages/alpha/src/domain/index.ts",
      "packages/alpha/src/application/index.ts",
      "packages/alpha/src/infrastructure/index.ts",
      "packages/shared/package.json",
      "packages/shared/tsconfig.json",
      "packages/shared/src/domain/index.ts",
      "packages/shared/src/application/index.ts",
      "packages/shared/src/infrastructure/index.ts",
    ];

    for (const rel of expectedFiles) {
      const abs = path.join(fixtureRoot, rel);
      const stat = await fs.stat(abs).catch(() => null);
      assert.ok(stat?.isFile(), `expected generated file to exist: ${rel}`);
    }
  });

  it("sync engine emits tsconfig references derived from depends_on", async () => {
    fixtureRoot = await createFixture(["alpha", "shared"]);

    const manifest: Manifest = {
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
        },
      },
      bounded_contexts: [
        { name: "shared", type: "shared-kernel" },
        { name: "alpha", type: "core", depends_on: ["shared"] },
      ],
    };

    const engine = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();

    const raw = await fs.readFile(
      path.join(fixtureRoot, "packages", "alpha", "tsconfig.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as {
      references?: Array<{ path: string }>;
    };
    assert.deepStrictEqual(
      parsed.references,
      [{ path: "../shared" }],
      "alpha tsconfig must contain a reference to ../shared derived from depends_on",
    );
  });
});
