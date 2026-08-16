#!/usr/bin/env node
/**
 * scripts/check-lint-coverage.mjs
 *
 * Guards the eslint leg of the CI merge gate (plan item 2.3 / AUD-019).
 *
 * `turbo run lint` runs the `lint` script in every workspace that HAS one and
 * silently skips every workspace that does not. Turbo reports success either
 * way, so a package can leave the firewall by deleting one line of package.json
 * and nothing goes red — the exact "gate that verifies nothing" failure mode
 * AUD-010 and AUD-019 record elsewhere in this repo.
 *
 * This asserts the skip set is EXACTLY `UNLINTED`. A new unlinted workspace
 * fails the build; a workspace that gains a lint script must be removed from
 * the list, so the list cannot rot into a permanent excuse.
 *
 * Exit codes: 0 compliant · 1 drift · 2 the check could not run.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Workspaces with no `lint` script TODAY. Each one needs `eslint` (and, for a
 * flat config, `@eslint/js` + `typescript-eslint`) as a devDependency before it
 * can get one, which is a dependency change — deliberately NOT bundled into the
 * CI-wiring change that introduced this file. Shrink this list; do not grow it.
 *
 * @hexagen/sync is the published CLI, so it is the highest-value entry to close.
 */
const UNLINTED = new Set([
  "@hexagen/api-gateway",
  "@hexagen/arch-linter",
  "@hexagen/manifest-generation",
  "@hexagen/project-generation",
  "@hexagen/sync",
  "@hexagen/template-engine",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function workspaceGlobs() {
  const root = readJson(join(ROOT, "package.json"));
  const globs = root.workspaces;
  if (!Array.isArray(globs) || globs.length === 0) {
    console.error(
      "❌ Root package.json declares no `workspaces` array — cannot enumerate packages.",
    );
    process.exit(2);
  }
  return globs;
}

function discoverPackages() {
  const found = [];
  for (const glob of workspaceGlobs()) {
    // The repo only uses single-level `dir/*` globs; anything else is a schema
    // change this check must be updated for rather than quietly ignore.
    if (!glob.endsWith("/*")) {
      console.error(
        `❌ Unsupported workspace glob "${glob}" — update this check.`,
      );
      process.exit(2);
    }
    const parent = join(ROOT, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(parent, entry.name, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = readJson(manifest);
      if (!pkg.name) continue;
      found.push({ name: pkg.name, hasLint: Boolean(pkg.scripts?.lint) });
    }
  }
  return found;
}

const packages = discoverPackages();

if (packages.length === 0) {
  console.error("❌ Discovered zero workspaces — refusing to report coverage.");
  process.exit(2);
}

const missing = packages.filter((p) => !p.hasLint).map((p) => p.name);
const unexpected = missing.filter((name) => !UNLINTED.has(name)).sort();
const stale = [...UNLINTED].filter((name) => !missing.includes(name)).sort();

const linted = packages.length - missing.length;
console.log(
  `Lint coverage: ${linted}/${packages.length} workspaces run eslint via \`turbo run lint\`.`,
);

if (unexpected.length > 0) {
  console.error("");
  console.error(
    "❌ Workspace(s) with no `lint` script and not on the documented list:",
  );
  for (const name of unexpected) console.error(`   → ${name}`);
  console.error("");
  console.error(
    "   `turbo run lint` skips these silently. Add a `lint` script,",
  );
  console.error(
    "   or add the package to UNLINTED in this file with a reason.",
  );
}

if (stale.length > 0) {
  console.error("");
  console.error(
    "❌ UNLINTED is stale — these workspaces now HAVE a `lint` script:",
  );
  for (const name of stale) console.error(`   → ${name}`);
  console.error("");
  console.error(
    "   Remove them from UNLINTED in scripts/check-lint-coverage.mjs.",
  );
}

if (unexpected.length > 0 || stale.length > 0) process.exit(1);

if (missing.length > 0) {
  console.log(
    `Known unlinted (tracked, needs an eslint devDependency): ${missing.sort().join(", ")}`,
  );
}
console.log("✅ Lint coverage matches the documented set.");
