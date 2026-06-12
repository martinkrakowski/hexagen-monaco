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
 *      generated project (not the monorepo) — the issue #179 regression guard —
 *      AND that the dry-run left the git-committed scaffold byte-identical:
 *      porcelain-clean + tree-snapshot-equal + no report file (PR-A2, RCA #3).
 *   7. Assert no stray `@hexagen/` (private scope) leaked into project files.
 *
 * Usage: node scripts/capstone/first-run-green.js   (or: yarn capstone)
 * Exits non-zero on any failure.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// The two tooling packages, each with its OWN version — they're co-released at
// the same version today, but read each independently so a divergence doesn't
// reference a non-existent tarball.
const PACKAGES = [
  { short: "sync", dir: "packages/sync" },
  { short: "arch-linter", dir: "tools/arch-linter" },
];
const pkgVersion = (dir) =>
  JSON.parse(readFileSync(path.join(REPO, dir, "package.json"), "utf8"))
    .version;

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

// Directory-aware tree snapshot (dirs + file hashes, sorted). Complements
// `git status --porcelain` in the PR-A2 purity check: porcelain cannot see
// empty directories, which is exactly what the pre-A2 ungated mkdirs created.
const snapshotTreeWithDirs = (root) => {
  const out = [];
  // Skip set is deliberately minimal (review #315): nothing runs between the
  // before/after snapshots except `sync --dry-run`, so ANY diff — .yarn
  // included — is signal, and the scaffold sans node_modules is small enough
  // that hashing it is trivial. Narrowing the walk would blind the oracle.
  const skip = new Set(["node_modules", ".git"]);
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(`${relPath}/`);
        walk(abs, relPath);
      } else if (entry.isFile()) {
        out.push(
          `${relPath} sha256:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`,
        );
      } else {
        out.push(`${relPath} (symlink)`);
      }
    }
  };
  walk(root, "");
  return out.sort();
};

try {
  // 1. Build the two tooling packages AND their workspace deps. Use turbo
  //    (build dependsOn ["^build"]) so @hexagen/project-configuration, shared,
  //    etc. are built first — tsup inlines them and needs their dist/ to exist.
  //    (`yarn workspace … build` alone fails on a fresh checkout.)
  step("Building @hexagen/sync + @hexagen/arch-linter (with deps)…");
  sh(
    "yarn turbo run build --filter=@hexagen/sync --filter=@hexagen/arch-linter",
  );

  // 2. Stage + pack → tarballs. Name each tarball from its OWN version (that's
  //    what `npm pack` writes), so co-release version drift can't break this.
  const packDir = mkdtempSync(path.join(tmpdir(), "capstone-pack-"));
  cleanup.push(() => rmSync(packDir, { recursive: true, force: true }));
  const tarball = {};
  for (const { short, dir } of PACKAGES) {
    const version = pkgVersion(dir);
    // prepare-publish always creates <dir>/publish; remove it in `finally` so a
    // pack (or prepare) failure never leaves staging dirs mutating the repo.
    const publishDir = path.join(REPO, dir, "publish");
    try {
      sh(`node scripts/prepare-publish-package.js ${dir}`);
      sh(`npm pack --pack-destination "${packDir}"`, { cwd: publishDir });
    } finally {
      rmSync(publishDir, { recursive: true, force: true });
    }
    tarball[short] = path.join(
      packDir,
      `hexagen-monaco-${short}-${version}.tgz`,
    );
  }
  step("Packed @hexagen-monaco/{sync,arch-linter}");

  // 3. Generate a bare scaffold (scope `acme`) into a temp project.
  const proj = mkdtempSync(path.join(tmpdir(), "capstone-proj-"));
  cleanup.push(() => rmSync(proj, { recursive: true, force: true }));
  try {
    sh(`yarn tsx scripts/capstone/generate-scaffold.ts "${proj}"`);
  } catch (e) {
    fail("scaffold generation failed", String(e.stdout || e.stderr || e));
  }
  // A manifest with one bounded context, so the installed CLI has work to do.
  // Kept in a const: phase 6c corrupts and then restores this exact content.
  const MANIFEST_YAML =
    "system: acme-app\nscope: acme\narchitecture: modular-monolith\n" +
    "bounded_contexts:\n  - name: shared\n    type: shared-kernel\n" +
    "    description: Shared primitives\n    layers:\n      domain: {}\n";
  const manifestPath = path.join(proj, ".architecture/manifest.yaml");
  mkdirSync(path.join(proj, ".architecture"), { recursive: true });
  writeFileSync(manifestPath, MANIFEST_YAML);
  step("Generated scaffold (scope: acme)");

  // 4. resolutions → packed tarballs (stands in for the unpublished registry).
  const pkgPath = path.join(proj, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.resolutions = {
    "@hexagen-monaco/sync": `file:${tarball.sync}`,
    "@hexagen-monaco/arch-linter": `file:${tarball["arch-linter"]}`,
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  // 5. Install — the core first-run-green proof.
  step("corepack enable + yarn install…");
  // Two CI-default Yarn gates both raise YN0028 ("the lockfile would have been
  // created … explicitly forbidden") on this first install — opt out of both.
  const projSh = (cmd) =>
    execSync(cmd, {
      cwd: proj,
      stdio: "pipe",
      encoding: "utf8",
      env: {
        ...process.env,
        // A freshly generated scaffold has no yarn.lock yet — this is the
        // documented first-run case (see SETUP.md / plan Item 2). Both gates
        // must be opted out: hardened mode (public-PR CI) and immutable installs
        // (Yarn's CI-default). A real user's first push has the same situation;
        // they commit the lockfile after this step.
        YARN_ENABLE_HARDENED_MODE: "0",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
      },
    });
  projSh("corepack enable");
  // Use the full `name@version` packageManager string (not a fragile @-split).
  const pm =
    typeof pkg.packageManager === "string" ? pkg.packageManager : "yarn@4.12.0";
  projSh(`corepack prepare ${pm} --activate`);
  try {
    projSh("yarn install");
  } catch (e) {
    fail(
      "yarn install of the generated scaffold failed",
      String(e.stdout || e),
    );
  }
  step("yarn install succeeded ✅");

  // PR-A2 (RCA #3) purity baseline: commit the scaffold so the dry-run below
  // can be checked for byte-identity two ways — `git status --porcelain`
  // (content changes / additions / deletions) and a tree snapshot (empty
  // dirs, which porcelain cannot see). The generated .gitignore already
  // excludes node_modules and yarn install state, so the commit stays small.
  projSh("git init -q");
  projSh("git add -A");
  projSh(
    'git -c user.email=capstone@test.invalid -c user.name="Capstone" commit -q -m baseline',
  );
  const beforeSnap = snapshotTreeWithDirs(proj);

  // 6. Issue #179 guard: the INSTALLED bin must resolve the generated project.
  let dry;
  try {
    dry = projSh("node_modules/.bin/hexagen sync --dry-run --allow-dirty");
  } catch (e) {
    dry = String(e.stdout || e);
  }
  // Compare against the realpath too: mkdtemp under os.tmpdir() can be a symlink
  // (macOS /var/folders → /private/var/folders) and the CLI may log the realpath.
  const realProj = realpathSync(proj);
  if (!dry.includes(proj) && !dry.includes(realProj)) {
    fail(
      "installed hexagen CLI did not resolve the generated project root (issue #179 regression)",
      dry,
    );
  }
  if (dry.includes(REPO) || dry.includes(realpathSync(REPO))) {
    fail(
      "installed hexagen CLI resolved the MONOREPO (issue #179 regression)",
      dry,
    );
  }
  step("Installed CLI resolves the generated project, not the monorepo ✅");

  // 6-purity (PR-A2, RCA #3): the dry-run above must not have changed one
  // byte of the committed scaffold. Pre-A2 it unlinked legacy empty barrels,
  // mkdir'd layer folders, and wrote SYNC-MIGRATION-REPORT.md.
  const porcelain = projSh("git status --porcelain");
  if (porcelain.trim() !== "") {
    fail("dry-run mutated the scaffold (RCA #3 purity regression)", porcelain);
  }
  const afterSnap = snapshotTreeWithDirs(proj);
  if (JSON.stringify(afterSnap) !== JSON.stringify(beforeSnap)) {
    const beforeSet = new Set(beforeSnap);
    const afterSet = new Set(afterSnap);
    const added = afterSnap.filter((e) => !beforeSet.has(e));
    const removed = beforeSnap.filter((e) => !afterSet.has(e));
    fail(
      "dry-run changed the scaffold tree (git-invisible empty dirs?)",
      `added:\n${added.join("\n") || "(none)"}\nremoved:\n${removed.join("\n") || "(none)"}`,
    );
  }
  if (existsSync(path.join(proj, "SYNC-MIGRATION-REPORT.md"))) {
    fail(
      "dry-run wrote SYNC-MIGRATION-REPORT.md (PR-A2 report gate regression)",
    );
  }
  step("Dry-run left the scaffold byte-identical ✅");

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
  step(
    "Installed `hexagen sync` materialized the project + ran arch-linter ✅",
  );

  // Decision D5: REAL runs keep writing the default migration report — only
  // dry-run suppresses it (PR-A2). Guards the inverse of the purity check.
  if (!existsSync(path.join(proj, "SYNC-MIGRATION-REPORT.md"))) {
    fail(
      "real sync did not write SYNC-MIGRATION-REPORT.md (decision D5 default)",
    );
  }
  step("Real sync wrote the default migration report (D5) ✅");

  // 6c. Honest-exit-codes guard (plan PR-A1, RCA #2): a broken manifest must
  //     make the INSTALLED bins exit non-zero. Pre-A1, `sync --dry-run` logged
  //     "Sync failed" but exited 0 — this capstone would have stayed green.
  writeFileSync(manifestPath, MANIFEST_YAML + "bogus_unknown_key: 1\n");
  let brokenDryFailed = false;
  let brokenDryOut = "";
  try {
    brokenDryOut = projSh(
      "node_modules/.bin/hexagen sync --dry-run --allow-dirty",
    );
  } catch (e) {
    brokenDryFailed = true;
    brokenDryOut = String(e.stdout || "") + String(e.stderr || "");
  }
  if (!brokenDryFailed) {
    fail(
      "`hexagen sync --dry-run` exited 0 on a broken manifest (RCA #2 exit-code swallow regression)",
      brokenDryOut,
    );
  }
  if (!brokenDryOut.includes("Failed to parse manifest")) {
    fail(
      "broken-manifest dry-run failed, but not with the expected manifest parse error",
      brokenDryOut,
    );
  }
  let brokenLintFailed = false;
  let brokenLintOut = "";
  try {
    brokenLintOut = projSh("node_modules/.bin/hexagen-lint");
  } catch (e) {
    brokenLintFailed = true;
    brokenLintOut = String(e.stdout || "") + String(e.stderr || "");
  }
  if (!brokenLintFailed) {
    fail("`hexagen-lint` exited 0 on a broken manifest", brokenLintOut);
  }
  // Same specific-reason guard as the dry-run probe above: a broken shim or
  // startup crash also exits non-zero — only the manifest-load failure counts.
  if (!brokenLintOut.includes("Could not load architecture manifest")) {
    fail(
      "broken-manifest lint failed, but not with the expected manifest load error",
      brokenLintOut,
    );
  }
  writeFileSync(manifestPath, MANIFEST_YAML);
  step("Broken manifest → installed bins exit non-zero ✅");

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

  // Best-effort cleanup (matches the failure path): a transient FS error here
  // must not turn an otherwise-passing capstone into a failure.
  for (const fn of cleanup) {
    try {
      fn();
    } catch {
      /* best effort */
    }
  }
  console.log(
    "\n✅ CAPSTONE PASSED — first-run-green: the generated project installs the",
  );
  console.log(
    "   @hexagen-monaco tooling and the installed CLI targets it correctly.",
  );
} catch (err) {
  fail("unexpected error", err?.stack || String(err));
}
