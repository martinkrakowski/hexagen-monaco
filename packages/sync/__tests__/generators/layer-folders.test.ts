/**
 * ensureLayerFolders contract (PR-B2 + review fixes + Wave-C keeps).
 *
 * Deliverables: layer DIRECTORIES (barrels are single-owned by the recursive
 * pass since PR-B2) plus a `.gitkeep` in each LEAF directory (Wave-C — git
 * cannot track an empty dir, so a scaffold without keeps exists in every
 * working copy but in no fresh checkout; the first consumer wiring
 * `sync --check` into CI hit 22 pending dir-creates on a locally converged
 * tree). Leaf = configured dir with no configured subfolders; the rule is
 * CONFIG-derived, which is what makes dry-run plan byte-identically to a real
 * run. Counting stays probe-first: an absent dir/keep is created and counted,
 * an existing dir contributes NOTHING, a keep-only dir records `unchanged` —
 * the converged-tree zero that `sync --check` gates on.
 *
 * The --only cases pin the review fix: the scope guard matches the layer
 * DIRECTORY path or its BARREL path. The barrel arm is load-bearing — the
 * recursive-barrels owner skips layer dirs that don't exist on disk, so a
 * file-deep pattern (`--only packages/billing/src/domain/index.ts`) on a
 * missing directory produced literally nothing when the guard was
 * directory-only: no dir from this generator, hence no barrel from recursive,
 * exit 0. The keep path itself fails such a file-deep pattern and lands in
 * `skipped` — the documented scoped-run convergence limit.
 */
import { describe, it } from "vitest";
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
// directories per module, of which 5 are leaves (domain + the 4 subfolders)
// and therefore carry a .gitkeep — 12 created paths on a fresh module.
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

describe("ensureLayerFolders (directories + leaf keeps, probe-first counting)", () => {
  it("creates and counts absent dirs + leaf keeps once; a converged tree contributes zero ops (RCA #5)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, moduleDir }) => {
      const config = makeConfig(workspaceRoot);

      const first = await ensureLayerFolders(moduleDir, LAYERS, config);
      assert.strictEqual(
        first.created.length,
        12,
        "7 dirs + 5 leaf keeps created on run 1",
      );
      assert.strictEqual(first.totalOps, 12, "each created path is one op");
      assert.ok(
        await dirExists(path.join(moduleDir, "src/application/ports/in")),
        "subfolder materialized",
      );
      assert.strictEqual(
        await fs.readFile(
          path.join(moduleDir, "src/application/ports/in/.gitkeep"),
          "utf8",
        ),
        "",
        "leaf subfolder carries an empty .gitkeep",
      );
      assert.strictEqual(
        await fs
          .stat(path.join(moduleDir, "src/application/.gitkeep"))
          .then(() => true)
          .catch(() => false),
        false,
        "a layer dir WITH configured subfolders is not a leaf — no keep (kept transitively)",
      );

      const second = await ensureLayerFolders(moduleDir, LAYERS, config);
      assert.strictEqual(
        second.totalOps,
        0,
        "second run must plan zero ops — the pre-B2 every-run mkdir counting",
      );
      assert.strictEqual(second.created.length, 0, "nothing newly created");
      assert.strictEqual(
        second.unchanged.length,
        5,
        "the 5 keep-only leaves report `unchanged` (byte-converged, not an op)",
      );
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
      // The keep path itself fails the file-deep pattern: safeWriteFileAtomic
      // routes it to `skipped` (not an op) and writes nothing — the documented
      // scoped-run convergence limit, mirroring the dir/barrel preview note.
      assert.deepStrictEqual(
        result.skipped,
        [path.join(domainDir, ".gitkeep")],
        "the leaf keep is out of the file-deep scope — skipped, never written",
      );
      assert.strictEqual(
        await fs
          .stat(path.join(domainDir, ".gitkeep"))
          .then(() => true)
          .catch(() => false),
        false,
        "no keep on disk under a file-deep --only",
      );
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

  it("dry-run plans the same dirs + keeps it would create and touches nothing (PR-A2)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, moduleDir }) => {
      const config = makeConfig(workspaceRoot, { dryRun: true });

      const result = await ensureLayerFolders(moduleDir, LAYERS, config);
      assert.strictEqual(
        result.totalOps,
        12,
        "plans all 7 dir creates + 5 leaf keeps — byte-identical to a real run",
      );
      assert.strictEqual(result.created.length, 12, "all planned as creates");
      assert.strictEqual(
        await dirExists(path.join(moduleDir, "src/domain")),
        false,
        "dry-run materializes nothing",
      );
    });
  });

  it("a leaf with real content gets no keep and no record (git already tracks it)", async () => {
    await withTempWorkspace(async ({ workspaceRoot, moduleDir }) => {
      const domainDir = path.join(moduleDir, "src/domain");
      await fs.mkdir(domainDir, { recursive: true });
      await fs.writeFile(path.join(domainDir, "money.ts"), "export {};\n");

      const config = makeConfig(workspaceRoot);
      const result = await ensureLayerFolders(moduleDir, LAYERS, config);

      assert.strictEqual(
        await fs
          .stat(path.join(domainDir, ".gitkeep"))
          .then(() => true)
          .catch(() => false),
        false,
        "no keep is written next to real content",
      );
      assert.strictEqual(
        result.created.length,
        10,
        "the other 6 dirs + 4 leaf keeps — domain (dir and keep) is silent",
      );
      assert.strictEqual(result.unchanged.length, 0, "nothing recorded for it");
      assert.strictEqual(result.totalOps, 10, "counts match the created set");
    });
  });

  it("a hand-written keep (non-empty content) is preserved byte-for-byte and unrecorded", async () => {
    await withTempWorkspace(async ({ workspaceRoot, moduleDir }) => {
      const domainDir = path.join(moduleDir, "src/domain");
      const keepPath = path.join(domainDir, ".gitkeep");
      await fs.mkdir(domainDir, { recursive: true });
      await fs.writeFile(keepPath, "placeholder — do not remove\n");

      const config = makeConfig(workspaceRoot);
      const result = await ensureLayerFolders(moduleDir, LAYERS, config);

      assert.strictEqual(
        await fs.readFile(keepPath, "utf8"),
        "placeholder — do not remove\n",
        "hand-written keep content must never be rewritten to '' — that would plan a phantom update on every --check forever",
      );
      assert.ok(
        !result.created.includes(keepPath) &&
          !result.updated.includes(keepPath) &&
          !result.unchanged.includes(keepPath) &&
          !result.skipped.includes(keepPath),
        "a content-bearing keep is doing its one job already — no record in any bucket",
      );
      assert.strictEqual(
        result.totalOps,
        10,
        "the other 6 dirs + 4 leaf keeps; the pre-existing domain contributes zero ops",
      );
    });
  });
});
