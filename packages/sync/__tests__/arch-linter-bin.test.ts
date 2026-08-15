import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  archLinterCommand,
  resolveArchLinterBin,
} from "../src/arch-linter-bin.js";

const BIN = process.platform === "win32" ? "hexagen-lint.cmd" : "hexagen-lint";

/**
 * Writes a node_modules-installed arch-linter package whose `bin` field points
 * at `target`. The target path is deliberately arbitrary: resolution must follow
 * whatever the package declares, never a hard-coded `dist/…` layout.
 */
async function installPackage(
  root: string,
  pkgName: string,
  {
    built,
    target = "dist/somewhere/entry.js",
  }: { built: boolean; target?: string },
): Promise<string> {
  const pkgDir = path.join(root, "node_modules", ...pkgName.split("/"));
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: pkgName, bin: { "hexagen-lint": target } }),
  );
  const binTarget = path.join(pkgDir, target);
  if (built) {
    await fs.mkdir(path.dirname(binTarget), { recursive: true });
    await fs.writeFile(binTarget, "");
  }
  return binTarget;
}

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

  // Yarn only creates a node_modules/.bin entry for a bin target that exists at
  // install time. The linter's target is a build artifact, so in a fresh
  // checkout (install runs before the first build) the shim is never created
  // and the gate resolved nothing. Reading the package's own bin field is
  // immune to that ordering.
  it("falls back to the package's bin target when no .bin shim was created", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arch-bin-"));
    try {
      const binTarget = await installPackage(root, "@hexagen/arch-linter", {
        built: true,
      });
      const nested = path.join(root, "packages", "core");
      await fs.mkdir(nested, { recursive: true });

      assert.equal(resolveArchLinterBin(nested), binTarget);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("resolves the published @hexagen-monaco scope too", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arch-bin-"));
    try {
      const binTarget = await installPackage(
        root,
        "@hexagen-monaco/arch-linter",
        {
          built: true,
        },
      );
      assert.equal(resolveArchLinterBin(root), binTarget);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns null when the package is present but unbuilt (never a false 'found')", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arch-bin-"));
    try {
      await installPackage(root, "@hexagen/arch-linter", { built: false });

      // An installed-but-unbuilt linter cannot verify anything, so it must read
      // as "not installed" rather than resolve to a path that fails at exec.
      assert.equal(resolveArchLinterBin(root), null);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("prefers the .bin shim over the package fallback", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arch-bin-"));
    try {
      const binDir = path.join(root, "node_modules", ".bin");
      await fs.mkdir(binDir, { recursive: true });
      await fs.writeFile(path.join(binDir, BIN), "");
      await installPackage(root, "@hexagen/arch-linter", { built: true });

      assert.equal(resolveArchLinterBin(root), path.join(binDir, BIN));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  // Guard: this repo must be able to resolve its own linter. Without it, the
  // CI architecture gate can regress to "arch-linter not installed" — which is
  // how it went unverified in the first place (AUD-010). turbo.json wires
  // `@hexagen/sync#test` to `@hexagen/arch-linter#build` so dist/ is present.
  it("resolves the arch-linter installed in this monorepo", () => {
    assert.notEqual(
      resolveArchLinterBin(process.cwd()),
      null,
      "arch-linter is unresolvable from this repo — build @hexagen/arch-linter " +
        "(the strict sync gate depends on this resolving)",
    );
  });
});

describe("archLinterCommand", () => {
  it("execs a .bin shim directly", () => {
    assert.equal(
      archLinterCommand("/w/node_modules/.bin/hexagen-lint", "/usr/bin/node"),
      '"/w/node_modules/.bin/hexagen-lint"',
    );
  });

  it("launches a raw .js bin target through the current interpreter", () => {
    // A .js module is not directly executable on Windows, and on posix only if
    // the shebang + exec bit survived; going through node works either way.
    assert.equal(
      archLinterCommand(
        "/w/node_modules/@hexagen/arch-linter/dist/index.js",
        "/usr/bin/node",
      ),
      '"/usr/bin/node" "/w/node_modules/@hexagen/arch-linter/dist/index.js"',
    );
  });

  it("quotes paths containing spaces on both branches", () => {
    assert.equal(
      archLinterCommand("/my dir/.bin/hexagen-lint.cmd", "/usr/bin/node"),
      '"/my dir/.bin/hexagen-lint.cmd"',
    );
    assert.equal(
      archLinterCommand("/my dir/dist/index.mjs", "/my node/node"),
      '"/my node/node" "/my dir/dist/index.mjs"',
    );
  });
});
