/**
 * The point of this suite is ONE property, asserted against the real resolver:
 *
 *   walking up from a created scan workspace reaches a `node_modules` that
 *   holds the arch-linter.
 *
 * Everything else here is supporting detail. `resolveArchLinterBin` is imported
 * from `packages/sync` SOURCE rather than reimplemented, so if that walk ever
 * changes shape this test fails instead of quietly agreeing with a stale copy
 * of it. It is a published resolver and is deliberately not modified — the
 * workspace moves to satisfy it, not the other way round.
 */
import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveArchLinterBin } from "../../../../../packages/sync/src/arch-linter-bin";
import {
  findAppRoot,
  resolveScanWorkspaceBase,
  sweepStaleWorkspaces,
  SCAN_WORKSPACE_DIR_ENV,
  SCAN_WORKSPACE_DIR_NAME,
  STALE_WORKSPACE_MS,
} from "./workspace-root";

const created: string[] = [];

async function fixture(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop() as string;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

/**
 * Reproduce the runtime image's layout: the monorepo root package.json, the
 * linter shipped at `tools/arch-linter` (where Next's tracer puts it), the
 * `node_modules/@hexagen/arch-linter` link the Dockerfile creates, and the Next
 * app directory the server chdirs into.
 */
async function standaloneLikeTree(): Promise<string> {
  const root = await fixture("hexagen-approot-");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "hexagen-monaco", workspaces: ["apps/*"] }),
    "utf8",
  );
  const linter = path.join(root, "tools", "arch-linter");
  await mkdir(path.join(linter, "dist"), { recursive: true });
  await writeFile(
    path.join(linter, "package.json"),
    JSON.stringify({
      name: "@hexagen/arch-linter",
      bin: { "hexagen-lint": "dist/cli.js" },
    }),
    "utf8",
  );
  await writeFile(path.join(linter, "dist", "cli.js"), "#!/usr/bin/env node\n");
  await mkdir(path.join(root, "node_modules", "@hexagen"), { recursive: true });
  // EXACTLY the link apps/web/Dockerfile creates, relative form included.
  await symlink(
    path.join("..", "..", "tools", "arch-linter"),
    path.join(root, "node_modules", "@hexagen", "arch-linter"),
  );
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  return root;
}

describe("findAppRoot", () => {
  it("returns the nearest ancestor whose package.json declares workspaces", async () => {
    const root = await standaloneLikeTree();
    // apps/web has its own package.json, WITHOUT `workspaces` — the walk must
    // pass through it. (In dev this is the difference between putting scan
    // workspaces inside the Next project dir and putting them at the repo root.)
    await writeFile(
      path.join(root, "apps", "web", "package.json"),
      JSON.stringify({ name: "web" }),
      "utf8",
    );
    assert.equal(findAppRoot(path.join(root, "apps", "web")), root);
  });

  it("walks past a malformed package.json rather than stopping at it", async () => {
    const root = await standaloneLikeTree();
    const nested = path.join(root, "apps", "web");
    await writeFile(path.join(nested, "package.json"), "{ not json", "utf8");
    assert.equal(findAppRoot(nested), root);
  });

  it("finds the root when started from the root itself", async () => {
    const root = await standaloneLikeTree();
    assert.equal(findAppRoot(root), root);
  });
});

describe("resolveScanWorkspaceBase", () => {
  it("puts workspaces under the application root by default", async () => {
    const root = await standaloneLikeTree();
    const base = resolveScanWorkspaceBase({
      env: {},
      cwd: path.join(root, "apps", "web"),
    });
    assert.equal(base.source, "app-root");
    assert.equal(base.degradedReason, null);
    assert.equal(base.dir, path.join(root, SCAN_WORKSPACE_DIR_NAME));
  });

  it("prefers an absolute, usable env override", async () => {
    const root = await standaloneLikeTree();
    const override = path.join(root, "custom-workspaces");
    const base = resolveScanWorkspaceBase({
      env: { [SCAN_WORKSPACE_DIR_ENV]: override },
      cwd: path.join(root, "apps", "web"),
    });
    assert.equal(base.source, "env");
    assert.equal(base.dir, override);
    assert.equal(base.degradedReason, null);
  });

  it("rejects a relative override and says so, instead of joining it to cwd", async () => {
    const root = await standaloneLikeTree();
    const base = resolveScanWorkspaceBase({
      env: { [SCAN_WORKSPACE_DIR_ENV]: "relative/dir" },
      cwd: path.join(root, "apps", "web"),
    });
    // Falls through to the app root — but the rejection is still on the record.
    assert.equal(base.source, "app-root");
    assert.equal(base.dir, path.join(root, SCAN_WORKSPACE_DIR_NAME));
  });

  it("degrades to the OS temp dir ONLY with a reason naming every rejected candidate", () => {
    const base = resolveScanWorkspaceBase({
      env: { [SCAN_WORKSPACE_DIR_ENV]: "/mnt/read-only" },
      cwd: "/somewhere",
      ensureDir: () => "EACCES: permission denied",
      findAppRoot: () => "/app",
    });
    assert.equal(base.source, "os-tmp");
    assert.equal(base.dir, tmpdir());
    assert.notEqual(base.degradedReason, null);
    const reason = base.degradedReason as string;
    assert.ok(reason.includes("/mnt/read-only"));
    assert.ok(reason.includes(path.join("/app", SCAN_WORKSPACE_DIR_NAME)));
  });

  it("degrades when there is no application root above cwd", () => {
    const base = resolveScanWorkspaceBase({
      env: {},
      cwd: "/nowhere",
      findAppRoot: () => null,
    });
    assert.equal(base.source, "os-tmp");
    assert.ok((base.degradedReason as string).includes("/nowhere"));
  });

  it("never reports a degrade when it returns the intended directory", async () => {
    const root = await standaloneLikeTree();
    const base = resolveScanWorkspaceBase({
      env: {},
      cwd: path.join(root, "apps", "web"),
    });
    assert.equal(base.degradedReason, null);
    assert.notEqual(base.source, "os-tmp");
  });
});

describe("the walk-up property this module exists for", () => {
  it("resolves hexagen-lint by walking up from a workspace under the app root", async () => {
    const root = await standaloneLikeTree();

    const base = resolveScanWorkspaceBase({
      env: {},
      cwd: path.join(root, "apps", "web"),
    });
    const workspace = await mkdtemp(path.join(base.dir, "hexagen-scan-"));

    // <root>/.scan-workspaces/hexagen-scan-XXXX
    //   -> <root>/.scan-workspaces
    //   -> <root>          <- node_modules/@hexagen/arch-linter is here
    const resolved = resolveArchLinterBin(workspace);
    assert.equal(
      resolved,
      path.join(
        root,
        "node_modules",
        "@hexagen",
        "arch-linter",
        "dist",
        "cli.js",
      ),
    );
  });

  it("also resolves through a node_modules/.bin shim at the app root", async () => {
    const root = await standaloneLikeTree();
    const binDir = path.join(root, "node_modules", ".bin");
    await mkdir(binDir, { recursive: true });
    await symlink(
      path.join("..", "@hexagen", "arch-linter", "dist", "cli.js"),
      path.join(binDir, "hexagen-lint"),
    );

    const base = resolveScanWorkspaceBase({
      env: {},
      cwd: path.join(root, "apps", "web"),
    });
    const workspace = await mkdtemp(path.join(base.dir, "hexagen-scan-"));

    assert.equal(
      resolveArchLinterBin(workspace),
      path.join(binDir, "hexagen-lint"),
    );
  });

  it("leaves the app root itself alone — only the workspace moves", async () => {
    const root = await standaloneLikeTree();
    const base = resolveScanWorkspaceBase({
      env: {},
      cwd: path.join(root, "apps", "web"),
    });
    // The workspace is a SIBLING of node_modules' owner, never inside it: the
    // scanned tree must not end up somewhere the app also imports from.
    assert.equal(path.dirname(base.dir), root);
    assert.ok(!base.dir.includes(`${path.sep}node_modules${path.sep}`));
  });

  it("does NOT resolve from an os.tmpdir() workspace — the bug being fixed", async () => {
    const root = await standaloneLikeTree();
    const stray = await fixture("hexagen-scan-stray-");

    // The control for the two tests above: same tree, workspace outside it.
    // Asserted as "not this tree's linter" rather than "null", because whatever
    // happens to live above the host's temp directory is not ours to promise.
    const resolved = resolveArchLinterBin(stray);
    assert.ok(
      resolved === null || !resolved.startsWith(root),
      `expected no resolution from ${stray}, got ${String(resolved)}`,
    );
  });
});

describe("sweepStaleWorkspaces", () => {
  async function aged(
    dir: string,
    name: string,
    ageMs: number,
  ): Promise<string> {
    const full = path.join(dir, name);
    await mkdir(full, { recursive: true });
    await writeFile(path.join(full, "marker"), "x", "utf8");
    const when = new Date(Date.now() - ageMs);
    await utimes(full, when, when);
    return full;
  }

  it("removes abandoned workspaces of every creator's prefix", async () => {
    const base = await fixture("hexagen-sweep-");
    await aged(base, "hexagen-scan-aaa", STALE_WORKSPACE_MS * 2);
    await aged(base, "hexagen-clone-bbb", STALE_WORKSPACE_MS * 2);
    await aged(base, "hexagen-handoff-ccc", STALE_WORKSPACE_MS * 2);

    const removed = await sweepStaleWorkspaces(base);

    assert.deepEqual(removed.sort(), [
      "hexagen-clone-bbb",
      "hexagen-handoff-ccc",
      "hexagen-scan-aaa",
    ]);
    assert.deepEqual(await readdir(base), []);
  });

  it("never touches a workspace young enough to still be in use", async () => {
    const base = await fixture("hexagen-sweep-young-");
    // The longest route budget is 120s; this one is five minutes old and must
    // still survive, because the sweep's whole job is to be conservative.
    await aged(base, "hexagen-scan-live", 5 * 60 * 1000);

    assert.deepEqual(await sweepStaleWorkspaces(base), []);
    assert.deepEqual(await readdir(base), ["hexagen-scan-live"]);
  });

  it("never touches anything that is not a workspace, however old", async () => {
    const base = await fixture("hexagen-sweep-foreign-");
    await aged(base, "someone-elses-data", STALE_WORKSPACE_MS * 10);
    await writeFile(path.join(base, "README"), "keep me", "utf8");

    assert.deepEqual(await sweepStaleWorkspaces(base), []);
    assert.deepEqual((await readdir(base)).sort(), [
      "README",
      "someone-elses-data",
    ]);
  });

  it("returns empty rather than throwing when the base does not exist", async () => {
    const base = await fixture("hexagen-sweep-gone-");
    await rm(base, { recursive: true, force: true });
    assert.deepEqual(await sweepStaleWorkspaces(base), []);
  });
});
