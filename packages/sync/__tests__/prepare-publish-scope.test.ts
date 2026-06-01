import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// Path to the repo-root publish-staging script (../../../scripts from here).
const SCRIPT = fileURLToPath(
  new URL("../../../scripts/prepare-publish-package.js", import.meta.url),
);

/**
 * Create a minimal publishable fixture (package.json + dist/), run the staging
 * script against it, and return the staged manifest.
 */
async function stage(name: string): Promise<{ name: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prepublish-scope-"));
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.writeFile(path.join(dir, "dist", "index.js"), "export {};\n");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version: "1.2.3", type: "module" }, null, 2),
  );
  try {
    execFileSync("node", [SCRIPT, dir], { stdio: "ignore" });
    return JSON.parse(
      await fs.readFile(path.join(dir, "publish", "package.json"), "utf8"),
    ) as { name: string };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("prepare-publish-package scope rewrite", () => {
  it("rewrites @hexagen/* to @hexagen-monaco/* in the staged name", async () => {
    const staged = await stage("@hexagen/sync");
    assert.equal(staged.name, "@hexagen-monaco/sync");
  });

  it("only rewrites the scope, not the package portion", async () => {
    const staged = await stage("@hexagen/arch-linter");
    assert.equal(staged.name, "@hexagen-monaco/arch-linter");
  });

  it("leaves a non-@hexagen scope untouched", async () => {
    const staged = await stage("@acme/widget");
    assert.equal(staged.name, "@acme/widget");
  });

  it("does not rewrite a lookalike scope like @hexagenic/*", async () => {
    const staged = await stage("@hexagenic/thing");
    assert.equal(staged.name, "@hexagenic/thing");
  });
});
