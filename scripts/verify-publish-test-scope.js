#!/usr/bin/env node

/**
 * Run the test suite for everything that ships in a published package —
 * and prove the run was not vacuous.
 *
 * WHY THIS EXISTS
 * ---------------
 * `publish.yml` used to run `build` + `turbo run typecheck` and then publish.
 * No test was executed on the release path at any point. `sync-integrity.yml`
 * does run `turbo run test`, but only on `push`/`pull_request` to main/develop
 * — a `v*` tag triggers neither, and a tag can be pushed at any commit. So the
 * two npm packages that generated customer projects consume went to the public
 * registry with zero test evidence attached to the release itself.
 *
 * WHY A SCRIPT AND NOT A ONE-LINE `turbo run test --filter=...` STEP
 * ------------------------------------------------------------------
 * Turbo exits 0 when a `--filter` matches nothing:
 *
 *     $ turbo run test --filter='@hexagen/typo-does-not-exist...'
 *     No tasks were executed as part of this run.
 *     Tasks: 0 successful, 0 total
 *     $ echo $?
 *     0
 *
 * A filter typo, a package rename, or a change in turbo's filter semantics
 * would therefore turn the release gate into a green no-op — a check reporting
 * more confidence than it earned, which is precisely the failure class this
 * gate is meant to close. So the scope is DERIVED from the manifests,
 * cross-checked against what turbo actually resolved, and only then executed.
 *
 * WHAT "SHIPS" MEANS HERE
 * -----------------------
 * `scripts/prepare-publish-package.js` strips `workspace:` dependencies from
 * the staged manifest because tsup inlines them into `dist/` (ADR-0009,
 * `noExternal: [/^@hexagen\//]`). A published tarball therefore contains the
 * *transitive* workspace closure of its root, compiled in. Testing only
 * `packages/sync` would leave most of the shipped bytes unexercised. The
 * closure is walked transitively, through `dependencies` only — devDependencies
 * are not bundled and are not part of the shipped surface.
 *
 * WHAT IS DELIBERATELY NOT IN SCOPE
 * ---------------------------------
 * The unscoped `turbo run test` also runs `apps/web` and the other unpublished
 * workspaces. Those are not in any tarball, and coupling the release to them
 * means an unrelated failure in unpublished code blocks a publish. The gate is
 * scoped to the closure on purpose; the trade-off is stated in the PR.
 *
 * USAGE
 *   node scripts/verify-publish-test-scope.js <package-dir> [<package-dir>...]
 *   node scripts/verify-publish-test-scope.js --task typecheck:test packages/sync ...
 *   node scripts/verify-publish-test-scope.js --dry-run packages/sync ...
 *
 * `--task` selects the turbo task to gate on (default `test`). publish.yml
 * drives both `typecheck:test` and `test` through here so neither gate rests
 * on an unchecked `--filter`.
 *
 * `--dry-run` performs the derivation and the scope cross-check but does not
 * execute the tests (used by this script's own guard test).
 *
 * EXIT CODES
 *   0  Scope verified and every scheduled test task passed
 *   1  Bad arguments, unreadable manifest, or an empty/None closure
 *   2  Scope mismatch — turbo resolved a different package set than the
 *      manifests imply, or a package with a `test` script scheduled no task
 *   *  Otherwise turbo's own exit code (test failure propagates verbatim)
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** Workspace globs are all single-level (`apps/*`), so a readdir is enough. */
function readWorkspaceManifests() {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  const globs = rootPkg.workspaces ?? [];
  const byName = new Map();

  for (const glob of globs) {
    if (!glob.endsWith("/*")) {
      throw new Error(
        `Unsupported workspace glob "${glob}" — this script only understands single-level "dir/*" globs.`,
      );
    }
    const dir = path.join(REPO_ROOT, glob.slice(0, -2));
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(dir, entry.name, "package.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (!manifest.name) continue;
      byName.set(manifest.name, {
        name: manifest.name,
        dir: path.relative(REPO_ROOT, path.join(dir, entry.name)),
        workspaceDeps: Object.entries(manifest.dependencies ?? {})
          .filter(([, spec]) => String(spec).startsWith("workspace:"))
          .map(([depName]) => depName),
        scripts: manifest.scripts ?? {},
      });
    }
  }
  return byName;
}

/**
 * Transitive closure over `dependencies` using the `workspace:` protocol —
 * i.e. exactly the set tsup inlines into the published `dist/`.
 */
function resolveClosure(roots, manifests) {
  const closure = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (closure.has(name)) continue;
    const manifest = manifests.get(name);
    if (!manifest) {
      throw new Error(
        `"${name}" is a workspace: dependency but no workspace manifest declares that name.`,
      );
    }
    closure.add(name);
    queue.push(...manifest.workspaceDeps);
  }
  return closure;
}

function fail(code, message) {
  console.error(`\n::error::${message}`);
  process.exit(code);
}

// --- arguments -------------------------------------------------------------

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");

// Which turbo task to gate on. Defaults to `test`; publish.yml also uses this
// for `typecheck:test`, so BOTH release gates get the scope cross-check rather
// than only the loudest one. A bare `--filter` step is not a gate no matter
// which task it runs.
const taskIndex = argv.indexOf("--task");
const task = taskIndex === -1 ? "test" : argv[taskIndex + 1];
// `taskIndex + 1` would be index 0 when --task is absent (taskIndex === -1),
// which would silently swallow the first package dir — hence the explicit -1.
const taskValueIndex = taskIndex === -1 ? -1 : taskIndex + 1;
const packageDirs = argv.filter(
  (a, i) => a !== "--dry-run" && a !== "--task" && i !== taskValueIndex,
);

if (taskIndex !== -1 && !task) {
  fail(1, "--task given with no task name.");
}

if (packageDirs.length === 0) {
  fail(
    1,
    "No package dirs given. Usage: node scripts/verify-publish-test-scope.js [--task <turbo-task>] <package-dir>...",
  );
}

const manifests = readWorkspaceManifests();

const rootNames = packageDirs.map((dir) => {
  const manifestPath = path.join(REPO_ROOT, dir, "package.json");
  if (!fs.existsSync(manifestPath)) {
    fail(1, `No package.json at ${dir} — cannot determine the published root.`);
  }
  const name = JSON.parse(fs.readFileSync(manifestPath, "utf8")).name;
  if (!name) fail(1, `${dir}/package.json has no "name".`);
  return name;
});

let closure;
try {
  closure = resolveClosure(rootNames, manifests);
} catch (err) {
  fail(1, err.message);
}

const expected = [...closure].sort();
if (expected.length === 0) {
  fail(
    1,
    "Derived an empty publish closure — refusing to report a green gate.",
  );
}

const filters = expected.map((name) => `--filter=${name}`);

console.log("Published roots:");
for (const name of rootNames) console.log(`  ${name}`);
console.log(
  `\nBundled workspace closure (${expected.length} package(s) — these are inlined into the published dist/):`,
);
for (const name of expected) {
  const manifest = manifests.get(name);
  const marker = manifest.scripts[task] ? task : `NO "${task}" script`;
  console.log(`  ${name.padEnd(32)} ${manifest.dir.padEnd(28)} ${marker}`);
}

const untested = expected.filter((n) => !manifests.get(n).scripts[task]);
if (untested.length > 0) {
  // Not fatal — but it must be visible. A package that ships inside the tarball
  // with no suite of its own is a real hole in the evidence this gate produces,
  // and silence would overstate what the green check means.
  console.log(
    `\n::warning::Bundled but declaring no "${task}" script (covered only indirectly, if at all): ${untested.join(", ")}`,
  );
}

// --- cross-check the derived scope against what turbo actually resolves -----

console.log("\nCross-checking turbo's resolved scope against the manifests...");

const dry = spawnSync(
  "yarn",
  ["turbo", "run", task, ...filters, "--dry-run=json"],
  { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

if (dry.status !== 0) {
  console.error(dry.stdout ?? "");
  console.error(dry.stderr ?? "");
  fail(2, `turbo --dry-run failed with exit code ${dry.status}.`);
}

let plan;
try {
  plan = JSON.parse(dry.stdout.slice(dry.stdout.indexOf("{")));
} catch {
  fail(2, "Could not parse turbo's --dry-run=json output.");
}

const resolved = [...new Set(plan.packages ?? [])].sort();
const missing = expected.filter((n) => !resolved.includes(n));
const unexpected = resolved.filter((n) => !expected.includes(n));

if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) {
    console.error(`  Missing from turbo's scope: ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    console.error(`  Unexpected in turbo's scope: ${unexpected.join(", ")}`);
  }
  fail(
    2,
    "Publish test scope mismatch: turbo resolved a different package set than the manifests imply. Refusing to publish on an unverified gate.",
  );
}

// A filter can resolve a package and still schedule no work. Every closure
// member that declares a `test` script must appear as a scheduled `test` task,
// or the run is partially vacuous.
const scheduled = new Set(
  (plan.tasks ?? []).filter((t) => t.task === task).map((t) => t.package),
);
const notScheduled = expected.filter(
  (n) => manifests.get(n).scripts[task] && !scheduled.has(n),
);
if (notScheduled.length > 0) {
  fail(
    2,
    `These packages declare a "${task}" script but turbo scheduled no "${task}" task for them: ${notScheduled.join(", ")}`,
  );
}

const withScript = expected.filter((n) => manifests.get(n).scripts[task]);
if (withScript.length === 0) {
  fail(
    2,
    `No package in the publish closure declares a "${task}" script — this gate would verify nothing.`,
  );
}
console.log(
  `  OK — ${resolved.length} package(s) in scope, ${scheduled.size} "${task}" task(s) scheduled, ` +
    `${withScript.length} of which run a real "${task}" script.`,
);

if (dryRun) {
  console.log(`\n--dry-run: scope verified, "${task}" not executed.`);
  process.exit(0);
}

// --- execute ---------------------------------------------------------------

console.log(`\nRunning "${task}" across the publish closure...\n`);

const run = spawnSync(
  "yarn",
  [
    "turbo",
    "run",
    task,
    ...filters,
    "--continue",
    "--output-logs=full",
    "--log-order=stream",
  ],
  { cwd: REPO_ROOT, stdio: "inherit" },
);

if (run.status !== 0) {
  console.error(
    `\n::error::Publish-closure "${task}" failed (exit ${run.status}). Not publishing.`,
  );
}
process.exit(run.status ?? 1);
