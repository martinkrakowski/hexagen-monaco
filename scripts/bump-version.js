#!/usr/bin/env node

/**
 * bump-version.js — Lock-step version bump across the workspace.
 *
 * This monorepo versions in lock-step: the root package.json and most
 * `apps/*`, `packages/*`, and `tools/*` workspaces carry the same version,
 * matched by a `vX.Y.Z` git tag. This script moves that cohort in one shot.
 *
 * What it does:
 *   1. Reads the current version from the root package.json.
 *   2. Computes the target version (semver patch/minor/major, or an explicit
 *      --set value).
 *   3. Discovers every workspace package.json from the root `workspaces` globs
 *      (plus the root itself), and splits them into:
 *        - the lock-step cohort  (version === current root version), and
 *        - off-lock-step packages (anything else — e.g. an unreleased 0.0.0
 *          stub or an independently-versioned package).
 *   4. Bumps the cohort to the target. Off-lock-step packages are SKIPPED and
 *      reported by default; pass --all to bump them too.
 *   5. Rewrites only each file's own top-level `"version"` field — a surgical
 *      string replace, so indentation, key order, and the trailing newline are
 *      preserved (no JSON reformat).
 *
 * It does NOT git-commit or git-tag: that stays manual so it fits the
 * branch + PR workflow (tag the squash-merge commit after the PR lands). The
 * exact commands are printed at the end as a reminder.
 *
 * Usage:
 *   node scripts/bump-version.js [patch|minor|major] [options]
 *   node scripts/bump-version.js --set <X.Y.Z> [options]
 *
 *   # via the package.json script:
 *   yarn bump                # patch  (0.5.1 -> 0.5.2)  [default]
 *   yarn bump minor          #        (0.5.1 -> 0.6.0)
 *   yarn bump major          #        (0.5.1 -> 1.0.0)
 *   yarn bump --set 1.2.3    # explicit target
 *   yarn bump minor --dry-run
 *   yarn bump patch --all    # also bump off-lock-step packages
 *
 * Options:
 *   --set <X.Y.Z>   Set an explicit version (overrides the bump type).
 *   --all           Also bump packages not on the current lock-step version.
 *   --dry-run       Print the plan without writing any files.
 *   --yes, -y       Skip the interactive confirmation.
 *   --help, -h      Show this help.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SEMVER_STRICT = /^(\d+)\.(\d+)\.(\d+)$/;
const SEMVER_LOOSE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(
    [
      "Lock-step version bump across the workspace.",
      "",
      "Usage:",
      "  yarn bump [patch|minor|major] [--all] [--dry-run] [--yes]",
      "  yarn bump --set <X.Y.Z> [--all] [--dry-run] [--yes]",
      "",
      "Default bump type is 'patch'. Bumps only the lock-step cohort (packages",
      'already at the root version); off-version packages are skipped unless',
      "--all is given. Touches only the \"version\" field. Does not commit or tag.",
    ].join("\n"),
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { bump: null, set: null, all: false, dryRun: false, yes: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "patch" || a === "minor" || a === "major") {
      if (opts.bump) fail(`Multiple bump types given: "${opts.bump}" and "${a}".`);
      opts.bump = a;
    } else if (a === "--set") {
      opts.set = args[++i];
      if (!opts.set) fail("--set requires a version argument (e.g. --set 1.2.3).");
    } else if (a === "--all") {
      opts.all = true;
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--yes" || a === "-y") {
      opts.yes = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  if (opts.set && opts.bump) fail("Pass either a bump type OR --set, not both.");
  if (!opts.set && !opts.bump) opts.bump = "patch"; // friendly default
  return opts;
}

// ---------------------------------------------------------------------------
// Version math
// ---------------------------------------------------------------------------

function computeTarget(current, opts) {
  if (opts.set) {
    if (!SEMVER_LOOSE.test(opts.set)) fail(`--set value is not a valid version: ${opts.set}`);
    return opts.set;
  }
  const m = SEMVER_STRICT.exec(current);
  if (!m) {
    fail(`Root version "${current}" is not plain X.Y.Z — use --set for a prerelease/explicit bump.`);
  }
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (opts.bump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (opts.bump === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function workspaceGlobs(rootPkg) {
  const ws = rootPkg.workspaces;
  if (Array.isArray(ws)) return ws;
  if (ws && Array.isArray(ws.packages)) return ws.packages; // yarn classic object form
  return [];
}

/** Expand a `dir/*` (or exact `dir`) workspace pattern to package.json paths. */
function expandGlob(pattern) {
  const results = [];
  if (pattern.endsWith("/*")) {
    const base = path.join(ROOT, pattern.slice(0, -2));
    if (!fs.existsSync(base)) return results;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkg = path.join(base, entry.name, "package.json");
      if (fs.existsSync(pkg)) results.push(pkg);
    }
  } else {
    const pkg = path.join(ROOT, pattern, "package.json");
    if (fs.existsSync(pkg)) results.push(pkg);
  }
  return results;
}

function discoverPackageJsonFiles(rootPkg) {
  const files = new Set([path.join(ROOT, "package.json")]);
  for (const pattern of workspaceGlobs(rootPkg)) {
    for (const f of expandGlob(pattern)) files.add(f);
  }
  return [...files];
}

// ---------------------------------------------------------------------------
// Rewrite
// ---------------------------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace the first (top-level) `"version"` field, preserving formatting. */
function setVersionField(content, oldVersion, newVersion) {
  const needle = `"version": "${oldVersion}"`;
  const idx = content.indexOf(needle);
  if (idx !== -1) {
    return (
      content.slice(0, idx) + `"version": "${newVersion}"` + content.slice(idx + needle.length)
    );
  }
  // Fallback: tolerate arbitrary whitespace after the colon.
  const re = new RegExp(`"version":\\s*"${escapeRegex(oldVersion)}"`);
  return content.replace(re, `"version": "${newVersion}"`);
}

function confirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const rootPkg = readJson(path.join(ROOT, "package.json"));
  const current = rootPkg.version;
  const target = computeTarget(current, opts);

  console.log("");
  console.log("Workspace version bump");
  console.log("======================");
  console.log(`  Current (root): ${current}`);
  console.log(`  Target:         ${target}  ${opts.set ? "(--set)" : `(${opts.bump})`}`);
  if (opts.all) console.log("  Mode:           --all (include off-lock-step packages)");
  if (opts.dryRun) console.log("  *** DRY RUN — no files will be written ***");
  console.log("");

  const files = discoverPackageJsonFiles(rootPkg);
  const cohort = [];
  const offVersion = [];
  for (const file of files) {
    const pkg = readJson(file);
    const rel = path.relative(ROOT, file) || "package.json";
    (pkg.version === current ? cohort : offVersion).push({ file, rel, from: pkg.version });
  }

  const candidates = opts.all ? [...cohort, ...offVersion] : cohort;
  const planned = candidates.filter((p) => p.from !== target);

  for (const p of planned) {
    console.log(`  ${p.rel}: ${p.from} → ${target}`);
  }
  console.log("");

  if (offVersion.length > 0) {
    if (opts.all) {
      console.log(`Including ${offVersion.length} off-lock-step package(s) via --all.`);
    } else {
      console.log(
        `Skipping ${offVersion.length} off-lock-step package(s) (not at ${current}); pass --all to include:`,
      );
      for (const p of offVersion) console.log(`    ${p.rel}: ${p.from}`);
    }
    console.log("");
  }

  console.log(`Total: ${planned.length} of ${files.length} workspace package.json file(s) to update.`);

  if (planned.length === 0) {
    console.log("\nNothing to update — already at the target version.");
    return;
  }
  if (opts.dryRun) {
    console.log("\nDry run complete. No files were modified.");
    return;
  }

  if (!opts.yes) {
    const ok = await confirm("Apply these version changes?");
    if (!ok) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  for (const p of planned) {
    const content = fs.readFileSync(p.file, "utf8");
    const updated = setVersionField(content, p.from, target);
    if (updated === content) fail(`Could not locate the "version" field in ${p.rel}.`);
    fs.writeFileSync(p.file, updated);
  }

  console.log("");
  console.log(`Done. ${planned.length} file(s) updated to ${target}.`);
  console.log("");
  console.log("Next steps (commit + PR; tag after merge):");
  console.log(`  git checkout -b chore/bump-${target}`);
  console.log(`  git commit -am "chore: bump version to ${target}"`);
  console.log(`  # after the PR squash-merges to main:`);
  console.log(`  git tag v${target} && git push origin v${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
