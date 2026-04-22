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
 * Sync-engine flag preset for tests that need the engine to emit
 * root-level files (`package.json`, `tsconfig.base.json`, `turbo.json`)
 * via `generateRootFiles`. Those paths are in the `protectedFiles` set in
 * `fs-utils.ts`, so `safeWriteFileAtomic` refuses to write them unless
 * `forceRoot` is true. External mode + `force: true` + `forceRoot: true`
 * mirrors the settings the production external-mode adapter uses when
 * scaffolding fresh monorepos.
 */
function makeForceRootFlags(): SyncFlags {
  return {
    dryRun: false,
    force: true,
    forceRoot: true,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger: silentLogger,
  };
}

/**
 * Create a fresh, empty temp directory with no pre-populated root files.
 * Used by the rootFiles and apps idempotency tests so the engine writes
 * its root scaffolding into a truly blank slate (rather than having the
 * fixture's own minimal `package.json` / `tsconfig.base.json` collide
 * with the root-files generator's output).
 */
async function createEmptyFixture(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-sync-idempotency-empty-"));
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

  it("sync engine idempotent on fixture with generator.sync.stubs.enabled and bounded context having port/adapter declarations", async () => {
    // Rationale: exercises the full stub-emission → second-barrel-pass
    // pipeline. The second sync must be byte-identical, which is the
    // strongest available signal that:
    //   (a) the stubs generator preserves existing stubs on rerun
    //       (see stubs.ts `writeStubFile` hard no-overwrite guard), AND
    //   (b) the second-pass barrels, having re-scanned src/ after stub
    //       emission, produce identical content both runs.
    fixtureRoot = await createFixture(["orders"]);

    const manifest: Manifest = {
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
          stubs: {
            enabled: true,
            // Templates + naming left undefined — exercises the built-in
            // fallback cascade inside stubs.ts.
          },
        },
      },
      bounded_contexts: [
        {
          name: "orders",
          type: "core",
          layers: {
            domain: {
              entities: ["Order"],
              value_objects: ["OrderId"],
              ports: { out: ["OrderRepository"] },
            },
            application: {
              use_cases: ["PlaceOrder"],
              ports: { in: ["PlaceOrderCommand"] },
            },
            infrastructure: {
              adapters: ["OrderRepositoryPostgres"],
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
      "second run must be byte-identical with stubs + port/adapter declarations",
    );

    // Sanity: at least one stub file and its barrel ancestor were emitted.
    const stubPath = path.join(
      fixtureRoot,
      "packages/orders/src/domain/entities/Order.ts",
    );
    const stubStat = await fs.stat(stubPath).catch(() => null);
    assert.ok(stubStat?.isFile(), "Order entity stub must exist on disk");

    const entitiesBarrel = await fs.readFile(
      path.join(fixtureRoot, "packages/orders/src/domain/entities/index.ts"),
      "utf8",
    );
    assert.ok(
      entitiesBarrel.includes('export * from "./Order.js";'),
      "entities barrel must re-export the Order stub (second-pass barrel regen)",
    );
  });

  it("sync engine idempotent on fixture with monorepo.rootFiles templates", async () => {
    // Rationale: root files are gated by `isProtectedRoot`. We use a
    // brand-new empty directory (no pre-created package.json /
    // tsconfig.base.json) and `forceRoot: true` so the first run
    // actually writes them, then we verify the second run is identical.
    fixtureRoot = await createEmptyFixture();

    const manifest: Manifest = {
      system: "idempotent-fixture",
      scope: "idempotent-fixture",
      monorepo: {
        packageManager: "yarn@4.12.0",
        workspaces: ["apps/*", "packages/*"],
        rootFiles: {
          // Explicit templates — these exercise the manifest-driven path
          // (not the built-in fallback). Layout intentionally differs
          // slightly from built-ins so we know the manifest is used.
          packageJson: {
            template:
              '{\n  "name": "{system}",\n  "private": true,\n  "packageManager": "{packageManager}",\n  "workspaces": {workspaces}\n}\n',
          },
          tsConfig: {
            template:
              '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext"\n  }\n}\n',
          },
          turbo: {
            template:
              '{\n  "$schema": "https://turbo.build/schema.json",\n  "tasks": {\n    "build": {}\n  }\n}\n',
          },
        },
      },
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
        },
      },
      // Empty bounded_contexts — isolates rootFiles path from per-module
      // generators. We only want to assert on package.json / tsconfig.base.json
      // / turbo.json determinism here.
      bounded_contexts: [],
    };

    const engine = new SyncEngine(makeForceRootFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();
    const first = await snapshotTree(fixtureRoot);

    const engine2 = new SyncEngine(makeForceRootFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine2.run();
    const second = await snapshotTree(fixtureRoot);

    assert.deepStrictEqual(
      second,
      first,
      "second run must be byte-identical with monorepo.rootFiles templates",
    );

    // Sanity: the three root files exist with the manifest-declared
    // content (not the built-in fallback).
    const pkgJson = await fs.readFile(
      path.join(fixtureRoot, "package.json"),
      "utf8",
    );
    assert.ok(
      pkgJson.includes('"name": "idempotent-fixture"'),
      "root package.json must contain interpolated system name",
    );
    const tsconfigBase = await fs.readFile(
      path.join(fixtureRoot, "tsconfig.base.json"),
      "utf8",
    );
    assert.ok(
      tsconfigBase.includes('"target": "ES2022"'),
      "root tsconfig.base.json must reflect manifest template",
    );
    const turboJson = await fs.readFile(
      path.join(fixtureRoot, "turbo.json"),
      "utf8",
    );
    assert.ok(
      turboJson.includes('"$schema": "https://turbo.build/schema.json"'),
      "root turbo.json must reflect manifest template",
    );
  });

  it("sync engine idempotent on fixture with apps[] + generator.sync.apps.frameworks", async () => {
    // Rationale: covers the apps generator. The engine writes app
    // scaffolding under `${fixtureRoot}/apps/<name>/`; a rerun with the
    // same manifest must produce a byte-identical tree.
    fixtureRoot = await createEmptyFixture();

    const manifest: Manifest = {
      system: "apps-fixture",
      scope: "apps-fixture",
      monorepo: {
        packageManager: "yarn@4.12.0",
        workspaces: ["apps/*", "packages/*"],
      },
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
          apps: {
            frameworks: {
              // Partial manifest overrides — fields not declared fall
              // through to the built-in fallback (verifies the cascade
              // is order-stable across reruns).
              "next.js": {
                packageJson: {
                  template:
                    '{\n  "name": "@{system}/{appName}",\n  "private": true,\n  "type": "module"\n}\n',
                },
              },
              fastify: {
                entryPoint: {
                  path: "src/server.ts",
                  template: "// custom fastify entry for {appName}\n",
                },
              },
              "plain-ts": {},
            },
          },
        },
      },
      bounded_contexts: [],
      apps: [
        { name: "web", framework: "next.js" },
        { name: "api", framework: "fastify" },
      ],
    };

    const engine = new SyncEngine(makeForceRootFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();
    const first = await snapshotTree(fixtureRoot);

    const engine2 = new SyncEngine(makeForceRootFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine2.run();
    const second = await snapshotTree(fixtureRoot);

    assert.deepStrictEqual(
      second,
      first,
      "second run must be byte-identical with apps[] + frameworks config",
    );

    // Sanity: all three expected app artifacts exist for both apps.
    const webPkg = await fs.readFile(
      path.join(fixtureRoot, "apps/web/package.json"),
      "utf8",
    );
    assert.ok(
      webPkg.includes('"@apps-fixture/web"'),
      "web app package.json must come from the manifest override",
    );

    const webTsconfig = await fs.stat(
      path.join(fixtureRoot, "apps/web/tsconfig.json"),
    );
    assert.ok(webTsconfig.isFile(), "web app tsconfig.json must exist");

    const webEntry = await fs.stat(
      path.join(fixtureRoot, "apps/web/src/app/page.tsx"),
    );
    assert.ok(
      webEntry.isFile(),
      "web app Next.js entry point (src/app/page.tsx) must exist (built-in fallback)",
    );

    // Fastify: manifest overrode the entryPoint path to src/server.ts.
    const apiEntry = await fs.readFile(
      path.join(fixtureRoot, "apps/api/src/server.ts"),
      "utf8",
    );
    assert.ok(
      apiEntry.includes("custom fastify entry for api"),
      "api app entry must reflect the manifest-overridden entryPoint",
    );
  });
});
