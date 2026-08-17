#!/usr/bin/env node

/**
 * Prepare a publishable staging directory for a workspace package.
 *
 * Produces `<package>/publish/` containing a fully self-contained snapshot
 * suitable for `npm pack` / `npm publish`. The source package directory is
 * never mutated — this script is strictly additive and can be re-run freely.
 *
 * What it does:
 *   1. Reads `<package>/package.json` from the source tree
 *   2. Projects it to a minimal public manifest:
 *        - Drops `private`, `devDependencies`, `scripts`, and any workspace
 *          metadata fields (`workspaces`, `packageManager`, ...)
 *        - Filters `dependencies` to remove any spec using the `workspace:`
 *          protocol (those packages are assumed to be bundled into dist/)
 *        - Retains only fields meaningful to an external consumer
 *   3. Copies `<package>/dist/` into `<package>/publish/dist/`
 *   4. Copies `<package>/README.md` if present
 *   5. Copies `<package>/LICENSE`. A missing package-local LICENSE is a hard
 *      error — the repo-root LICENSE is the proprietary platform license and
 *      must not be silently shipped into a published tarball.
 *
 * Usage:
 *   node scripts/prepare-publish-package.js [package-dir]
 *
 * If [package-dir] is omitted, uses the current working directory.
 *
 * Post-conditions:
 *   - `<package>/publish/` exists and is ready for `npm pack`
 *   - Source `<package>/package.json` is byte-identical to its pre-run state
 *   - No workspace:* protocol references remain in the staged manifest
 *
 * Exit codes:
 *   0  Success
 *   1  Invalid package dir, missing dist/, or missing package-local LICENSE
 *   2  Package.json malformed or missing required fields
 */

import fs from "node:fs";
import path from "node:path";

// Internal monorepo scope → published npm scope. `@hexagen` was unavailable on
// npm, so the tooling publishes under `@hexagen-monaco`.
const SOURCE_SCOPE = "@hexagen";
const PUBLISH_SCOPE = "@hexagen-monaco";

/**
 * Fields retained verbatim from source package.json (when present).
 * Order is the emission order in the staged manifest.
 *
 * Deliberately EXCLUDED:
 *   - private           — prevents npm publish
 *   - devDependencies   — never shipped to consumers
 *   - scripts           — builder scripts reference dev-only paths (src/, ../../scripts)
 *   - workspaces        — meaningless outside a monorepo
 *   - packageManager    — consumer may use a different PM
 *   - resolutions       — yarn-specific, consumer-hostile
 */
const RETAINED_FIELDS = [
  "name",
  "version",
  "type",
  "description",
  "keywords",
  "license",
  "author",
  "contributors",
  "homepage",
  "repository",
  "bugs",
  "main",
  "module",
  "types",
  "bin",
  "files",
  "exports",
  "engines",
  "publishConfig",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  // `dependencies` handled separately (workspace: protocol stripped)
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`❌ Failed to parse ${filePath}: ${err.message}`);
    process.exit(2);
  }
}

function isWorkspaceProtocol(spec) {
  return typeof spec === "string" && spec.startsWith("workspace:");
}

/**
 * Return a cleaned `dependencies` object with all workspace:* specs removed.
 * Returns `undefined` when nothing remains — the caller omits the field
 * entirely so the staged manifest has no empty `"dependencies": {}`.
 */
function cleanDependencies(deps) {
  if (!deps) return undefined;
  const kept = {};
  for (const [name, spec] of Object.entries(deps)) {
    if (isWorkspaceProtocol(spec)) continue;
    kept[name] = spec;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
    // Symlinks intentionally ignored — not portable in tarballs
  }
}

function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else if (entry.isFile()) n += 1;
  }
  return n;
}

function prepare(packageDir) {
  const absPackageDir = path.resolve(packageDir);
  const srcPkgPath = path.join(absPackageDir, "package.json");

  if (!fs.existsSync(srcPkgPath)) {
    console.error(`❌ No package.json found at ${srcPkgPath}`);
    process.exit(1);
  }

  const srcPkg = readJson(srcPkgPath);
  if (!srcPkg.name || !srcPkg.version) {
    console.error(`❌ ${srcPkgPath} is missing required 'name' or 'version'`);
    process.exit(2);
  }

  const distDir = path.join(absPackageDir, "dist");
  if (!fs.existsSync(distDir)) {
    console.error(
      `❌ dist/ not found at ${distDir}. Run the package build before staging.`,
    );
    process.exit(1);
  }

  const publishDir = path.join(absPackageDir, "publish");
  fs.rmSync(publishDir, { recursive: true, force: true });
  fs.mkdirSync(publishDir, { recursive: true });

  // 1. Project source manifest to a minimal public manifest
  const staged = {};
  for (const field of RETAINED_FIELDS) {
    if (srcPkg[field] !== undefined) staged[field] = srcPkg[field];
  }

  // Rewrite the npm scope to the published org. The monorepo packages keep their
  // internal `@hexagen/*` names; only the PUBLISHED name uses `@hexagen-monaco`
  // (the `@hexagen` org was unavailable on npm — see the ADR-0009 amendment).
  // Self-contained bundles, so no dependency reference needs the same rewrite.
  if (
    typeof staged.name === "string" &&
    staged.name.startsWith(`${SOURCE_SCOPE}/`)
  ) {
    staged.name = `${PUBLISH_SCOPE}/${staged.name.slice(SOURCE_SCOPE.length + 1)}`;
  }

  const srcDepCount = Object.keys(srcPkg.dependencies || {}).length;
  const cleanedDeps = cleanDependencies(srcPkg.dependencies);
  if (cleanedDeps) staged.dependencies = cleanedDeps;
  let strippedDepCount = srcDepCount - Object.keys(cleanedDeps || {}).length;

  // peerDependencies / optionalDependencies are retained verbatim by the
  // projection above, so they need the same workspace:* stripping as
  // dependencies — otherwise the staged manifest can violate the
  // "no workspace:* references" guarantee and become uninstallable.
  for (const field of ["peerDependencies", "optionalDependencies"]) {
    if (!staged[field]) continue;
    const before = Object.keys(staged[field]).length;
    const cleaned = cleanDependencies(staged[field]);
    if (cleaned) staged[field] = cleaned;
    else delete staged[field];
    strippedDepCount += before - Object.keys(cleaned || {}).length;
  }

  fs.writeFileSync(
    path.join(publishDir, "package.json"),
    JSON.stringify(staged, null, 2) + "\n",
  );

  // 2. Copy dist/
  copyRecursive(distDir, path.join(publishDir, "dist"));

  // 3. Copy README.md (package-local only — repo-root README is not consumer-facing)
  const readmePath = path.join(absPackageDir, "README.md");
  const readmeIncluded = fs.existsSync(readmePath);
  if (readmeIncluded) {
    fs.copyFileSync(readmePath, path.join(publishDir, "README.md"));
  }

  // 4. Copy LICENSE — package-local only. The repo-root LICENSE is the
  // proprietary platform grant; silently falling back to it would ship the
  // wrong terms into FSL wedge tarballs (ADR-0061).
  const packageLicense = path.join(absPackageDir, "LICENSE");
  if (!fs.existsSync(packageLicense)) {
    console.error(
      `❌ No package-local LICENSE at ${packageLicense}. ` +
        `Refusing to fall back to the repo-root platform LICENSE.`,
    );
    process.exit(1);
  }
  fs.copyFileSync(packageLicense, path.join(publishDir, "LICENSE"));

  // Summary
  const fileCount = countFiles(publishDir);
  const strippedFields = [
    srcPkg.private ? "private" : null,
    srcPkg.devDependencies ? "devDependencies" : null,
    srcPkg.scripts ? "scripts" : null,
    srcPkg.workspaces ? "workspaces" : null,
    srcPkg.packageManager ? "packageManager" : null,
  ].filter(Boolean);

  console.log(
    `✅ Staged publishable package at ${path.relative(process.cwd(), publishDir) || publishDir}`,
  );
  console.log(`   Name:     ${staged.name}@${staged.version}`);
  console.log(`   Files:    ${fileCount} total`);
  console.log(
    `   Stripped: ${strippedDepCount} workspace dep(s); field(s): ${strippedFields.join(", ") || "none"}`,
  );
  if (!readmeIncluded) {
    console.log(
      `   ⚠  No README.md at package root — consumers may need context`,
    );
  }
  console.log(``);
  console.log(
    `   Next: cd ${path.relative(process.cwd(), publishDir) || publishDir} && npm pack`,
  );
}

const arg = process.argv[2];
const target = arg ? path.resolve(arg) : process.cwd();
prepare(target);
