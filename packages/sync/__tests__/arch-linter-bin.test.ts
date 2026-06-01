import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveArchLinterBin } from "../src/arch-linter-bin.js";

const BIN = process.platform === "win32" ? "hexagen-lint.cmd" : "hexagen-lint";

describe("resolveArchLinterBin", () => {
  it("walks up to a node_modules/.bin in a parent directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arch-bin-"));
    try {
      const binDir = path.join(root, "node_modules", ".bin");
      await fs.mkdir(binDir, { recursive: true });
      await fs.writeFile(path.join(binDir, BIN), "");
      const nested = path.join(root, "packages", "core");
      await fs.mkdir(nested, { recursive: true });

      // The bin lives at the root's node_modules, but the manifest dir is
      // nested — the resolver must still find it by walking up.
      assert.equal(resolveArchLinterBin(nested), path.join(binDir, BIN));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns null when no installed bin is found (so callers report it distinctly)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arch-bin-"));
    try {
      assert.equal(resolveArchLinterBin(root), null);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
