import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hexagenScanArgv, resolveHexagenBin } from "./hexagen-bin";

describe("hexagenScanArgv", () => {
  it("spawns a .js CLI through node with scan --yes --root", () => {
    const { file, args } = hexagenScanArgv(
      "/repo/packages/sync/dist/cli.js",
      "/tmp/staged",
      "/usr/bin/node",
    );
    assert.equal(file, "/usr/bin/node");
    assert.deepEqual(args, [
      "/repo/packages/sync/dist/cli.js",
      "scan",
      "--yes",
      "--root",
      "/tmp/staged",
    ]);
    assert.ok(args.includes("scan"));
    assert.ok(args.includes("--yes"));
    assert.ok(args.includes("--root"));
  });

  it("spawns a bin shim directly with scan --yes --root", () => {
    const { file, args } = hexagenScanArgv(
      "/repo/node_modules/.bin/hexagen",
      "/tmp/staged",
    );
    assert.equal(file, "/repo/node_modules/.bin/hexagen");
    assert.deepEqual(args, ["scan", "--yes", "--root", "/tmp/staged"]);
  });
});

describe("resolveHexagenBin", () => {
  it("resolves packages/sync bin.hexagen from the workspace root, not process.cwd()", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hexagen-bin-root-"));
    try {
      const cli = path.join(root, "packages", "sync", "dist", "cli.js");
      await mkdir(path.dirname(cli), { recursive: true });
      await writeFile(
        path.join(root, "packages", "sync", "package.json"),
        JSON.stringify({ bin: { hexagen: "dist/cli.js" } }),
      );
      await writeFile(cli, "#!/usr/bin/env node\n");

      const resolved = resolveHexagenBin(root);
      assert.equal(resolved, cli);
      assert.notEqual(resolved, process.cwd());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns null when the binary is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hexagen-bin-missing-"));
    try {
      assert.equal(resolveHexagenBin(root), null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
