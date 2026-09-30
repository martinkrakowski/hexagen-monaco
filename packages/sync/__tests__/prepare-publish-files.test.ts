import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `scripts/prepare-publish-package.js` ships exactly what the source
 * package.json's `files` array lists (OW7: orchestration's `bin/` and `public/`
 * were silently dropped when only `dist/` was copied). Asserted against the REAL
 * script on a throwaway fixture.
 */
const SCRIPT = fileURLToPath(
  new URL("../../../scripts/prepare-publish-package.js", import.meta.url),
);

async function makeFixture(files: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prepublish-files-"));
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.writeFile(path.join(dir, "dist", "index.js"), "export {};\n");
  await fs.mkdir(path.join(dir, "bin"), { recursive: true });
  await fs.writeFile(path.join(dir, "bin", "run.sh"), "#!/bin/sh\n", {
    mode: 0o755,
  });
  await fs.mkdir(path.join(dir, "public", "x"), { recursive: true });
  await fs.writeFile(path.join(dir, "public", "x", "index.html"), "<p>x</p>");
  await fs.writeFile(path.join(dir, "LICENSE"), "FIXTURE-LICENSE\n");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@hexagen/files-fixture", version: "1.0.0", files }),
  );
  return dir;
}

const stage = (dir: string) =>
  spawnSync("node", [SCRIPT, dir], { encoding: "utf8" });

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

describe("prepare-publish-package `files` staging", () => {
  it("copies every listed entry, keeping the executable bit", async () => {
    const dir = await makeFixture(["dist", "bin", "public"]);
    try {
      assert.equal(stage(dir).status, 0);
      const pub = path.join(dir, "publish");
      assert.equal(await exists(path.join(pub, "dist", "index.js")), true);
      assert.equal(
        await exists(path.join(pub, "public", "x", "index.html")),
        true,
      );
      const mode = (await fs.stat(path.join(pub, "bin", "run.sh"))).mode;
      assert.ok((mode & 0o111) !== 0, "bin/run.sh must stay executable");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT ship a bin/ that `files` does not list", async () => {
    const dir = await makeFixture(["dist"]);
    try {
      assert.equal(stage(dir).status, 0);
      assert.equal(await exists(path.join(dir, "publish", "bin")), false);
      assert.equal(await exists(path.join(dir, "publish", "public")), false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails naming a listed entry that does not exist", async () => {
    const dir = await makeFixture(["dist", "nope"]);
    try {
      const r = stage(dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /"nope" does not exist/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses globs and entries that escape the package", async () => {
    for (const bad of ["bin/*", "../outside"]) {
      const dir = await makeFixture(["dist", bad]);
      try {
        const r = stage(dir);
        assert.equal(r.status, 1, bad);
        assert.match(r.stderr, new RegExp("plain path"), bad);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });
});
