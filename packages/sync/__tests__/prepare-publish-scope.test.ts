import { describe, it } from "vitest";
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
type StagedManifest = {
  name: string;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

async function stage(
  name: string,
  extra: Record<string, unknown> = {},
): Promise<StagedManifest> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prepublish-scope-"));
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.writeFile(path.join(dir, "dist", "index.js"), "export {};\n");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name, version: "1.2.3", type: "module", ...extra },
      null,
      2,
    ),
  );
  try {
    execFileSync("node", [SCRIPT, dir], { stdio: "ignore" });
    return JSON.parse(
      await fs.readFile(path.join(dir, "publish", "package.json"), "utf8"),
    ) as StagedManifest;
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

describe("prepare-publish-package workspace stripping", () => {
  it("strips workspace:* from peerDependencies and optionalDependencies", async () => {
    const staged = await stage("@acme/widget", {
      peerDependencies: { "@acme/core": "workspace:*", react: "^18.0.0" },
      optionalDependencies: { "@acme/extras": "workspace:*" },
    });
    // Workspace specs gone; the real third-party peer is kept.
    assert.deepEqual(staged.peerDependencies, { react: "^18.0.0" });
    // optionalDependencies had only a workspace spec → field omitted entirely.
    assert.equal(staged.optionalDependencies, undefined);
  });

  it("produces a manifest with no workspace: references at all", async () => {
    const staged = await stage("@acme/widget", {
      dependencies: { "@acme/shared": "workspace:*", lodash: "^4.0.0" },
      peerDependencies: { "@acme/core": "workspace:*" },
    });
    assert.ok(
      !JSON.stringify(staged).includes("workspace:"),
      "no workspace: spec may remain in the staged manifest",
    );
  });
});
