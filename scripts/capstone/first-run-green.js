#!/usr/bin/env node
/**
 * Item 5 capstone — first-run-green proof (hermetic for the @hexagen-monaco
 * tooling; public deps come from the registry/yarn cache).
 *
 * Proves that a freshly generated project can install the published tooling and
 * use it, WITHOUT a real npm release:
 *
 *   1. Build @hexagen/sync + @hexagen/arch-linter.
 *   2. Stage + `npm pack` both → @hexagen-monaco/* tarballs.
 *   3. Generate a bare scaffold (scope `acme`) via the real generator — NOT the
 *      self-regen CLI (which targets the package it lives in; see issue #179).
 *   4. Point the scaffold's tooling devDeps at the tarballs via `resolutions`.
 *   5. `corepack enable` + `yarn install` — assert it resolves + installs.
 *   6. Run the INSTALLED `hexagen` bin (--dry-run) and assert it resolves the
 *      generated project (not the monorepo) — the issue #179 regression guard.
 *   7. Assert no stray `@hexagen/` (private scope) leaked into project files.
 *
 * Usage: node scripts/capstone/first-run-green.js   (or: yarn capstone)
 * Exits non-zero on any failure.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VERSION = JSON.parse(
  readFileSync(path.join(REPO, "packages/sync/package.json"), "utf8"),
).version;

const sh = (cmd, opts = {}) =>
  execSync(cmd, { cwd: REPO, stdio: "pipe", encoding: "utf8", ...opts });

const cleanup = [];
const fail = (msg, detail = "") => {
  console.error(`\n❌ CAPSTONE FAILED: ${msg}`);
  if (detail) console.error(detail);
  for (const fn of cleanup) {
    try {
      fn();
    } catch {
      /* best effort */
    }
  }
  process.exit(1);
};
const step = (msg) => console.log(`• ${msg}`);

try {
  // 1. Build the two tooling packages AND their workspace deps. Use turbo
  //    (build dependsOn ["^build"]) so @hexagen/project-configuration, shared,
  //    etc. are built first — tsup inlines them and needs their dist/ to exist.
  //    (`yarn workspace … build` alone fails on a fresh checkout.)
  step("Building @hexagen/sync + @hexagen/arch-linter (with deps)…");
  sh(
    "yarn turbo run build --filter=@hexagen/sync --filter=@hexagen/arch-linter",
  );

  // 2. Stage + pack → tarballs.
  const packDir = mkdtempSync(path.join(tmpdir(), "capstone-pack-"));
  cleanup.push(() => rmSync(packDir, { recursive: true, force: true }));
  for (const dir of ["packages/sync", "tools/arch-linter"]) {
    sh(`node scripts/prepare-publish-package.js ${dir}`);
    sh(`npm pack --pack-destination "${packDir}"`, {
      cwd: path.join(REPO, dir, "publish"),
    });
    rmSync(path.join(REPO, dir, "publish"), { recursive: true, force: true });
  }
  const tgz = (name) =>
    path.join(packDir, `hexagen-monaco-${name}-${VERSION}.tgz`);
  step(`Packed @hexagen-monaco/{sync,arch-linter}@${VERSION}`);

  // 3. Generate a bare scaffold (scope `acme`) into a temp project.
  const proj = mkdtempSync(path.join(tmpdir(), "capstone-proj-"));
  cleanup.push(() => rmSync(proj, { recursive: true, force: true }));
  try {
    sh(`npx tsx scripts/capstone/generate-scaffold.ts "${proj}"`);
  } catch (e) {
    fail("scaffold generation failed", String(e.stdout || e.stderr || e));
  }
  // A manifest with one bounded context, so the installed CLI has work to do.
  execSync(`mkdir -p "${proj}/.architecture"`);
  writeFileSync(
    path.join(proj, ".architecture/manifest.yaml"),
    "system: acme-app\nscope: acme\narchitecture: modular-monolith\n" +
      "bounded_contexts:\n  - name: shared\n    type: shared-kernel\n" +
      "    description: Shared primitives\n    layers:\n      domain: {}\n",
  );
  step("Generated scaffold (scope: acme)");

  // 4. resolutions → packed tarballs (stands in for the unpublished registry).
  const pkgPath = path.join(proj, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.resolutions = {
    "@hexagen-monaco/sync": `file:${tgz("sync")}`,
    "@hexagen-monaco/arch-linter": `file:${tgz("arch-linter")}`,
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  // 5. Install — the core first-run-green proof.
  step("corepack enable + yarn install…");
  const projSh = (cmd) =>
    execSync(cmd, { cwd: proj, stdio: "pipe", encoding: "utf8" });
  projSh("corepack enable");
  // Use the full `name@version` packageManager string (not a fragile @-split).
  const pm =
    typeof pkg.packageManager === "string" ? pkg.packageManager : "yarn@4.12.0";
  projSh(`corepack prepare ${pm} --activate`);
  try {
    projSh("yarn install");
  } catch (e) {
    fail("yarn install of the generated scaffold failed", String(e.stdout || e));
  }
  step("yarn install succeeded ✅");

  // 6. Issue #179 guard: the INSTALLED bin must resolve the generated project.
  let dry;
  try {
    dry = projSh("node_modules/.bin/hexagen sync --dry-run --allow-dirty");
  } catch (e) {
    dry = String(e.stdout || e);
  }
  if (!dry.includes(proj)) {
    fail(
      "installed hexagen CLI did not resolve the generated project root (issue #179 regression)",
      dry,
    );
  }
  if (dry.includes(REPO)) {
    fail("installed hexagen CLI resolved the MONOREPO (issue #179 regression)", dry);
  }
  step("Installed CLI resolves the generated project, not the monorepo ✅");

  // 6b. Materialize for real with the installed CLI. This generates the
  //     .architecture/invariants + module scaffolding AND runs the installed
  //     arch-linter (hexagen-lint) internally — exercising BOTH published bins
  //     end to end, not just resolving them.
  try {
    projSh("node_modules/.bin/hexagen sync --force --force-root --allow-dirty");
  } catch (e) {
    fail(
      "`hexagen sync` (real) in the generated project failed — generation or the arch-linter bin broke",
      String(e.stdout || e),
    );
  }
  step("Installed `hexagen sync` materialized the project + ran arch-linter ✅");

  // 7. No private @hexagen/ scope in emitted project files (tooling is
  //    @hexagen-monaco). package.json is the highest-risk file (devDeps,
  //    resolutions, bin-referencing scripts), so include it explicitly.
  for (const f of [
    "package.json",
    ".yarnrc.yml",
    "tsconfig.base.json",
    "SETUP.md",
    ".gitignore",
  ]) {
    const content = readFileSync(path.join(proj, f), "utf8");
    if (/@hexagen\//.test(content)) {
      fail(`emitted ${f} leaked the private @hexagen/ scope`);
    }
  }
  step("No private @hexagen/ scope leaked into project files ✅");

  for (const fn of cleanup) fn();
  console.log("\n✅ CAPSTONE PASSED — first-run-green: the generated project installs the");
  console.log("   @hexagen-monaco tooling and the installed CLI targets it correctly.");
} catch (err) {
  fail("unexpected error", err?.stack || String(err));
}
