import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error -- root script, plain ESM without a declaration file
import { lockedVersion } from "../../../scripts/locked-dependency-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SCRIPT = path.join(REPO_ROOT, "scripts/locked-dependency-version.mjs");

const PKG = JSON.stringify({ devDependencies: { prettier: "^3.2.5" } });

const REAL_BLOCK = `"prettier@npm:^3.2.5":
  version: 3.8.1
  resolution: "prettier@npm:3.8.1"
  bin:
    prettier: bin/prettier.cjs
  languageName: node
`;

const DECOY_BLOCK = `"prettier@npm:^2.0.0":
  version: 2.8.8
  resolution: "prettier@npm:2.8.8"
  languageName: node
`;

/**
 * The lint workflow's docs-only fast path runs `npx prettier@<this>` because
 * node_modules is absent there and a bare `npx prettier` fetches the newest
 * release, not the locked one (85 false positives on 2026-08-23). Each case
 * below is a mutation the first two drafts of this lookup got wrong.
 */
describe("scripts/locked-dependency-version.mjs", () => {
  it("returns the version of the block matching the root selector", () => {
    assert.equal(lockedVersion("prettier", PKG, REAL_BLOCK), "3.8.1");
  });

  it("is not fooled by a different-range block that appears first", () => {
    // "first prettier@ block wins" returned 2.8.8 here.
    assert.equal(
      lockedVersion("prettier", PKG, DECOY_BLOCK + "\n" + REAL_BLOCK),
      "3.8.1",
    );
  });

  it("matches a multi-selector lockfile key", () => {
    const multi = REAL_BLOCK.replace(
      '"prettier@npm:^3.2.5":',
      '"prettier@npm:^3.0.0, prettier@npm:^3.2.5":',
    );
    assert.equal(lockedVersion("prettier", PKG, multi), "3.8.1");
  });

  it("does not substring-match a longer selector", () => {
    const longer = REAL_BLOCK.replace("^3.2.5", "^3.2.50").replace(
      "3.8.1",
      "9.9.9",
    );
    assert.equal(lockedVersion("prettier", PKG, longer), null);
  });

  it("returns null when the block is absent or the name is not a root dependency", () => {
    assert.equal(lockedVersion("prettier", PKG, DECOY_BLOCK), null);
    assert.equal(lockedVersion("eslint", PKG, REAL_BLOCK), null);
  });

  it("agrees with the real lockfile and the installed prettier", async () => {
    const [pkg, lock] = await Promise.all([
      fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
      fs.readFile(path.join(REPO_ROOT, "yarn.lock"), "utf8"),
    ]);
    const fromLock = lockedVersion("prettier", pkg, lock);
    assert.ok(fromLock, "real lockfile must resolve prettier");
    const installed = execFileSync(
      process.execPath,
      [
        path.join(REPO_ROOT, "node_modules", "prettier", "bin", "prettier.cjs"),
        "--version",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    ).trim();
    assert.equal(fromLock, installed);
  });

  it("CLI prints the version on success and exits 1 without printing a guess otherwise", () => {
    const ok = spawnSync("node", [SCRIPT, "prettier"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(ok.status, 0);
    assert.match(ok.stdout.trim(), /^\d+\.\d+\.\d+$/);

    const missing = spawnSync(
      "node",
      [SCRIPT, "definitely-not-a-root-dependency"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /no block matching/);

    const noArg = spawnSync("node", [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(noArg.status, 1);
    assert.equal(noArg.stdout, "");
  });
});
