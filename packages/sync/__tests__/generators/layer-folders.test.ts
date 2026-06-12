/**
 * ensureLayerFolders contract (PR-B2 + review fixes).
 *
 * Directories are this generator's ONLY deliverable since PR-B2 (barrels are
 * single-owned by the recursive pass), and the counting is probe-first: an
 * absent directory is created and counted, an existing one contributes
 * NOTHING — the converged-tree zero that `sync --check` gates on.
 *
 * The --only cases pin the review fix: the scope guard matches the layer
 * DIRECTORY path or its BARREL path. The barrel arm is load-bearing — the
 * recursive-barrels owner skips layer dirs that don't exist on disk, so a
 * file-deep pattern (`--only packages/billing/src/domain/index.ts`) on a
 * missing directory produced literally nothing when the guard was
 * directory-only: no dir from this generator, hence no barrel from recursive,
 * exit 0.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureLayerFolders } from "../../src/generators/layer-folders.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";

const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

// Same layers shape the contract fixtures arm: 3 layers + 4 subfolders = 7
// directories per module.
const LAYERS = {
  domain: { folder: "src/domain" },
  application: {
    folder: "src/application",
    subfolders: ["ports/in", "ports/out", "use-cases"],
  },
  infrastructure: { folder: "src/infrastructure", subfolders: ["adapters"] },
};

function makeConfig(
  workspaceRoot: string,
  overrides: Partial<SyncConfig> = {},
): SyncConfig {
  return {
    dryRun: false,
    force: false,
    forceRoot: false,
    allowDirty: false,
    strict: false,
    mode: "external",
    logger: silentLogger,
    manifest: {},
    workspaceRoot,
    ...overrides,
  };
}

async function withTempWorkspace(
  fn: (ctx: { workspaceRoot: string; moduleDir: string }) => Promise<void>,
) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-layerfolders-test-"),
  );
  const moduleDir = path.join(workspaceRoot, "packages", "billing");
  await fs.mkdir(moduleDir, { recursive: true });
  try {
    await fn({ workspaceRoot, moduleDir });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

describe("ensureLayerFolders (directories only, probe-first counting)", () => {
  it("creates and counts absent dirs once; a converged tree contributes zero ops (RCA #5)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, moduleDir }) => {
      const config = makeConfig(workspaceRoot);

      const first = await ensureLayerFolders(moduleDir, LAYERS, config);
      assert.strictEqual(first.created.length, 7, "7 dirs created on run 1");
      assert.strictEqual(first.totalOps, 7, "each created dir is one op");
      assert.ok(
        await dirExists(path.join(moduleDir, "src/application/ports/in")),
        "subfolder materialized",
      );

      const second = await ensureLayerFolders(moduleDir, LAYERS, config);
      assert.strictEqual(
        second.totalOps,
        0,
        "second run must plan zero ops — the pre-B2 every-run mkdir counting",
      );
      assert.strictEqual(second.created.length, 0, "nothing newly created");
      assert.strictEqual(
        second.skipped.length,
        0,
        "existing dirs are silent, not `skipped` (skipped means deliberately left alone)",
      );
    });
  });

  it("file-deep --only naming a layer barrel still produces the directory (review fix)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, moduleDir }) => {
      const domainDir = path.join(moduleDir, "src/domain");
      const config = makeConfig(workspaceRoot, {
        only: ["packages/billing/src/domain/index.ts"],
      });

      const result = await ensureLayerFolders(moduleDir, LAYERS, config);
      assert.ok(
        await dirExists(domainDir),
        "the targeted barrel's directory must exist — recursive-barrels can only plan a barrel inside an existing dir",
      );
      assert.deepStrictEqual(
        result.created,
        [domainDir],
        "exactly the targeted layer's dir is created",
      );
      assert.strictEqual(result.totalOps, 1, "one counted op");
      assert.strictEqual(
        await dirExists(path.join(moduleDir, "src/application")),
        false,
        "unrelated layers stay out of scope",
      );
    });
  });

  it("out-of-scope --only contributes nothing: no dirs, zero ops", async () => {
    await withTempWorkspace(async ({ workspaceRoot, moduleDir }) => {
      const config = makeConfig(workspaceRoot, {
        only: ["packages/other"],
      });

      const result = await ensureLayerFolders(moduleDir, LAYERS, config);
      assert.strictEqual(result.totalOps, 0, "zero ops out of scope");
      assert.strictEqual(result.created.length, 0, "nothing created");
      assert.strictEqual(
        await dirExists(path.join(moduleDir, "src/domain")),
        false,
        "no filesystem side effects out of scope",
      );
    });
  });

  it("dry-run plans the same dirs it would create and touches nothing (PR-A2)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, moduleDir }) => {
      const config = makeConfig(workspaceRoot, { dryRun: true });

      const result = await ensureLayerFolders(moduleDir, LAYERS, config);
      assert.strictEqual(result.totalOps, 7, "plans all 7 dir creates");
      assert.strictEqual(
        await dirExists(path.join(moduleDir, "src/domain")),
        false,
        "dry-run materializes nothing",
      );
    });
  });
});
