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
 *   4. Pin gate (PR-A3, RCA #1): assert the scaffold's emitted tooling ranges
 *      are satisfied by the packed tarball versions, THEN point them at the
 *      tarballs via `resolutions`. Resolutions exist for hermeticity (the
 *      registry has no unpublished version) but would also mask a
 *      scaffold/engine version skew — so the contract is asserted, not
 *      bypassed. (Registry availability itself stays a runbook invariant:
 *      publish v<version> before/with any wizard deploy that bumps it.)
 *   5. `corepack enable` + `yarn install` — assert it resolves + installs.
 *   6. Run the INSTALLED `hexagen` bin (--dry-run) and assert it resolves the
 *      generated project (not the monorepo) — the issue #179 regression guard —
 *      AND that the dry-run left the git-committed scaffold byte-identical:
 *      porcelain-clean + tree-snapshot-equal + no report file (PR-A2, RCA #3).
 *      Then materialize for real (6b), prove broken-manifest exit codes (6c,
 *      PR-A1), and prove a failed sync under --allow-dirty never rolls back
 *      and unaffected untracked files survive (6d, PR-B1 RCA #4). Finally the
 *      convergence rows (PR-B2, RCA #5): `sync --check` exits 0 with
 *      `Total ops : 0` on the materialized tree (6e), and a second REAL sync
 *      — live preflight build included — is byte-level idempotent (6f).
 *   7. Assert no stray `@hexagen/` (private scope) leaked into project files.
 *
 * Usage: node scripts/capstone/first-run-green.js   (or: yarn capstone)
 * Exits non-zero on any failure.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Default-import the CJS module (its named exports aren't statically
// analyzable); declared in the ROOT devDependencies — capstone is a root
// script (PR-A3 pin gate).
import semver from "semver";

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
const snapshotTreeWithDirs = (root, extraSkip = []) => {
  const out = [];
  // Skip set is deliberately minimal (review #315): nothing runs between the
  // before/after snapshots except `sync --dry-run`, so ANY diff — .yarn
  // included — is signal, and the scaffold sans node_modules is small enough
  // that hashing it is trivial. Narrowing the walk would blind the oracle.
  // `extraSkip` (entry NAMES, matched at any depth) exists for the 6f
  // idempotence row, where a real preflight build runs between the snapshots
  // and its outputs (dist/, .turbo/) plus the run-log report are expected,
  // documented churn — see 6f for why each name is excluded.
  const skip = new Set(["node_modules", ".git", ...extraSkip]);
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
  const packedVersion = {}; // short → version, for the PR-A3 pin gate below
  for (const { short, dir } of PACKAGES) {
    const version = pkgVersion(dir);
    packedVersion[short] = version;
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
  // generator.sync.layers is ARMED (PR-B2, RCA #5): the layer-dir mkdir
  // accounting and the recursive-barrels ownership are exactly the surfaces
  // the convergence rows (6e/6f) gate, and a layer-less manifest would leave
  // them unexercised. It sits BEFORE bounded_contexts on purpose — 6c/6d
  // append to this string, so bounded_contexts must stay the last top-level
  // key for "  - name: omega…" to extend the context list.
  const MANIFEST_YAML =
    "system: acme-app\nscope: acme\narchitecture: modular-monolith\n" +
    "generator:\n  sync:\n    layers:\n" +
    "      domain:\n        folder: src/domain\n" +
    "      application:\n        folder: src/application\n" +
    "        subfolders:\n          - ports/in\n          - ports/out\n" +
    "          - use-cases\n" +
    "      infrastructure:\n        folder: src/infrastructure\n" +
    "        subfolders:\n          - adapters\n" +
    "bounded_contexts:\n  - name: shared\n    type: shared-kernel\n" +
    "    description: Shared primitives\n    layers:\n      domain: {}\n";
  const manifestPath = path.join(proj, ".architecture/manifest.yaml");
  mkdirSync(path.join(proj, ".architecture"), { recursive: true });
  writeFileSync(manifestPath, MANIFEST_YAML);
  step("Generated scaffold (scope: acme)");

  // 4a. Pin gate (PR-A3, RCA #1): the scaffold's emitted ranges must be
  //     satisfied by what we're about to install — BEFORE resolutions force
  //     the tarballs regardless. This is what caught nothing for two
  //     releases: the template hardcoded ^0.4.0 while the engine shipped
  //     0.6.0, and resolutions papered over the skew. Proves
  //     self-consistency only (emitted range ↔ packed version); cross-version
  //     compatibility is PR-C1's job.
  const pkgPath = path.join(proj, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  for (const { short } of PACKAGES) {
    const name = `@hexagen-monaco/${short}`;
    const emittedRange = pkg.devDependencies?.[name];
    if (!emittedRange) {
      fail(`scaffold package.json is missing the ${name} devDependency`);
    }
    if (!semver.satisfies(packedVersion[short], emittedRange)) {
      fail(
        `scaffold pins ${name}@${emittedRange} but the packed tarball is ` +
          `${packedVersion[short]} — version-derived pins are broken (RCA #1)`,
      );
    }
  }
  step(
    `Pin gate: scaffold ranges satisfied by packed versions (` +
      PACKAGES.map(
        ({ short }) =>
          `${short}@${pkg.devDependencies[`@hexagen-monaco/${short}`]}←${packedVersion[short]}`,
      ).join(", ") +
      `)`,
  );

  // 4b. resolutions → packed tarballs (stands in for the unpublished registry).
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

  // 6d. Scoped-rollback guard (plan PR-B1, RCA #4): a mid-run failure under
  //     --allow-dirty must NOT roll anything back — pre-B1 the engine ran
  //     `git reset --hard HEAD && git clean -fd` against the whole project,
  //     which would delete BOTH untracked seeds below (the scratch file and
  //     the package.json backup).
  //
  //     Two ingredients. The converged project journals nothing on its own
  //     (every regenerated file is identical → unchanged, every layer dir
  //     already exists → probe-skipped); the fresh `omega` context WOULD
  //     journal its own dirs/barrels now that generator.sync.layers is armed
  //     (PR-B2), but the deleted-package.json ingredient is kept so the
  //     journal-print assertion pins a CROSS-module write — a pre-existing
  //     context's file recreated before the failing module — not just the
  //     sabotaged module's own scaffolding:
  //       1. shared's package.json is deleted → its recreation is the
  //          journaled write asserted below;
  //       2. a second context `omega` (6c's corrupt-then-restore manifest
  //          pattern) whose package.json is a DIRECTORY →
  //          generatePackageJson's pre-read throws EISDIR raw — AFTER
  //          shared's recreation, since modules run in manifest order.
  //     The failure must sit on generatePackageJson specifically: it throws;
  //     several other generators (e.g. tsconfig) catch into result.error
  //     instead, which the engine does not treat as fatal.
  const OMEGA_CONTEXT =
    "  - name: omega\n    type: core\n" +
    "    description: Rollback-phase sabotage context\n" +
    "    layers:\n      domain: {}\n";
  const sharedPkgJson = path.join(proj, "packages/shared/package.json");
  const sharedPkgBak = sharedPkgJson + ".capstone-bak";
  const omegaPkgJson = path.join(proj, "packages/omega/package.json");
  const scratchPath = path.join(proj, "capstone-scratch.txt");
  const SCRATCH_CONTENT = "capstone scratch - must survive a failed sync\n";
  writeFileSync(manifestPath, MANIFEST_YAML + OMEGA_CONTEXT);
  writeFileSync(scratchPath, SCRATCH_CONTENT);
  renameSync(sharedPkgJson, sharedPkgBak);
  mkdirSync(omegaPkgJson, { recursive: true });
  writeFileSync(path.join(omegaPkgJson, "placeholder"), "");
  let sabotagedFailed = false;
  let sabotagedOut = "";
  try {
    sabotagedOut = projSh("node_modules/.bin/hexagen sync --allow-dirty");
  } catch (e) {
    sabotagedFailed = true;
    sabotagedOut = String(e.stdout || "") + String(e.stderr || "");
  }
  if (!sabotagedFailed) {
    fail(
      "`hexagen sync` exited 0 despite the package.json-as-directory sabotage",
      sabotagedOut,
    );
  }
  if (!/EISDIR|illegal operation on a directory/.test(sabotagedOut)) {
    fail(
      "sabotaged sync failed, but not with the expected EISDIR",
      sabotagedOut,
    );
  }
  if (!sabotagedOut.includes("NO rollback under --allow-dirty")) {
    fail(
      "failed sync under --allow-dirty did not state the deliberate no-rollback (PR-B1)",
      sabotagedOut,
    );
  }
  if (!sabotagedOut.includes("packages/shared/package.json")) {
    fail(
      "journal print did not name the recreated package.json (PR-B1)",
      sabotagedOut,
    );
  }
  if (!existsSync(scratchPath)) {
    fail(
      "untracked scratch file was DELETED by a failed sync (RCA #4 `git clean -fd` regression)",
      sabotagedOut,
    );
  }
  if (readFileSync(scratchPath, "utf8") !== SCRATCH_CONTENT) {
    fail("untracked scratch file content changed across a failed sync");
  }
  if (!existsSync(sharedPkgBak)) {
    fail(
      "untracked package.json backup was DELETED by a failed sync (RCA #4 `git clean -fd` regression)",
      sabotagedOut,
    );
  }
  if (!existsSync(sharedPkgJson)) {
    fail(
      "recreated package.json missing after the failed run — under --allow-dirty sync's own writes must stay too",
      sabotagedOut,
    );
  }
  // Restore: undo the sabotage (omega dir, manifest, package.json, scratch) —
  // the backup IS the restore — then prove coherence with a dry-run of the
  // installed CLI. Dry-run (not real): at this point packages/shared is still
  // absent from the lockfile (it materialized after `yarn install`), so a
  // real sync's preflight `turbo run build` would fail for reasons unrelated
  // to PR-B1. The real-sync path, preflight included, is proven in 6f after
  // the lockfile refresh; here only plan-level reconvergence is the claim.
  rmSync(path.join(proj, "packages/omega"), { recursive: true, force: true });
  rmSync(sharedPkgJson, { recursive: true, force: true });
  renameSync(sharedPkgBak, sharedPkgJson);
  rmSync(scratchPath);
  writeFileSync(manifestPath, MANIFEST_YAML);
  try {
    projSh("node_modules/.bin/hexagen sync --dry-run --allow-dirty");
  } catch (e) {
    fail(
      "dry-run after un-sabotaging failed — project did not reconverge",
      String(e.stdout || "") + String(e.stderr || e),
    );
  }
  step(
    "Failed sync under --allow-dirty: no rollback, journal printed, untracked files survived ✅",
  );

  // 6e. Convergence gate row (PR-B2, RCA #5 — plan gate row 2): on the
  //     materialized project, `sync --check` must exit 0 and the counts must
  //     be truthful zeros. Pre-B2 this exact run reported a constant "67–70
  //     created" (every-run mkdir counting, plus the layer-folders↔recursive
  //     barrel churn) — a drift gate over lying counts would gate nothing.
  //     Running it after 6c/6d also gates THEIR restore paths: any residue
  //     either left behind shows up as pending ops here. --check implies
  //     --dry-run (so no preflight, no lockfile requirement); the tree is
  //     deliberately dirty (6b's materialization is uncommitted), hence
  //     --allow-dirty — the exact invocation the generated scaffold ships as
  //     its `sync:check` script, minus the dirt.
  let checkOut = "";
  try {
    checkOut = projSh("node_modules/.bin/hexagen sync --check --allow-dirty");
  } catch (e) {
    fail(
      "`hexagen sync --check` exited non-zero on the converged project (RCA #5 drift-gate regression)",
      String(e.stdout || "") + String(e.stderr || ""),
    );
  }
  if (!checkOut.includes("Total ops : 0")) {
    fail(
      "`sync --check` on the converged project did not report `Total ops : 0` (truthful-counts regression)",
      checkOut,
    );
  }
  step("Converged project: `sync --check` exits 0 with `Total ops : 0` ✅");

  // 6f. Idempotence row (PR-B2, RCA #5 — plan gate row 3): a SECOND real sync
  //     on the materialized project must be byte-level idempotent, live
  //     preflight build (real turbo + tsc) included. Three preparations, each
  //     load-bearing:
  //       1. Re-pin the tarball resolutions: 6b ran --force-root, which
  //          regenerates the root package.json from the template (correct —
  //          root files are generated deliverables under forced root), and
  //          that rewrite dropped the hermetic file: resolutions from 4b. A
  //          real consumer's second sync resolves the pins from the registry;
  //          the capstone re-pins to the packed tarballs to stay
  //          registry-free. The re-pin then SURVIVES the second sync because
  //          root files are root-protected without --force-root — exactly the
  //          documented consumer workflow (you own root files after
  //          generation).
  //       2. `yarn install` refresh: packages/shared materialized AFTER the
  //          first install, so the lockfile doesn't know the @acme/shared
  //          workspace yet and the preflight `turbo run build` would fail —
  //          the pre-existing limitation 6d documents. The refresh is what a
  //          consumer's post-sync `yarn install` does anyway.
  //       3. Warm `turbo run build` once: proves the generated project
  //          actually COMPILES with the real toolchain (the
  //          generated-output-compiles guarantee, enforced at the capstone
  //          layer for the first time) and materializes dist/ + .turbo/
  //          before the baseline commit, so the second sync's preflight is a
  //          byte-stable cache replay instead of a first build mid-oracle.
  const pkg2 = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg2.resolutions = {
    "@hexagen-monaco/sync": `file:${tarball.sync}`,
    "@hexagen-monaco/arch-linter": `file:${tarball["arch-linter"]}`,
  };
  writeFileSync(pkgPath, JSON.stringify(pkg2, null, 2));
  try {
    projSh("yarn install");
  } catch (e) {
    fail(
      "yarn install refresh (with @acme/shared materialized) failed",
      String(e.stdout || e),
    );
  }
  try {
    projSh("yarn turbo run build");
  } catch (e) {
    fail(
      "generated project does not build with the real toolchain (turbo + tsc)",
      String(e.stdout || "") + String(e.stderr || ""),
    );
  }
  step("Generated project builds with the real toolchain ✅");

  // The migration report is a per-run audit log (D5 keeps real runs writing
  // it — asserted after 6b), not part of the converged tree: its entries
  // legitimately differ between a first and a second run. Exclude it from
  // the fixture's git view via info/exclude — NOT the generated .gitignore,
  // which is itself a deliverable under test here.
  appendFileSync(
    path.join(proj, ".git", "info", "exclude"),
    "SYNC-MIGRATION-REPORT.md\n",
  );
  projSh("git add -A");
  projSh(
    'git -c user.email=capstone@test.invalid -c user.name="Capstone" commit -q -m materialized',
  );
  // dist/ + .turbo/ are build outputs the preflight replay owns; the report
  // is per-run (above). Everything else must be byte-identical — including
  // git-invisible EMPTY DIRS: armed subfolders like ports/in carry no barrel
  // by design (single barrel owner, PR-B2), so only this snapshot — not
  // porcelain — would catch a regression that deletes or re-creates them.
  const idemSkip = ["SYNC-MIGRATION-REPORT.md", "dist", ".turbo"];
  const beforeIdem = snapshotTreeWithDirs(proj, idemSkip);
  let secondOut = "";
  try {
    // No --allow-dirty: the tree is committed, so this also exercises the
    // engine's git-clean gate on the consumer path. No --force/--force-root:
    // a consumer's routine re-sync, the flags row 3 is a contract for.
    secondOut = projSh("node_modules/.bin/hexagen sync");
  } catch (e) {
    fail(
      "second real `hexagen sync` failed (preflight or generation)",
      String(e.stdout || "") + String(e.stderr || ""),
    );
  }
  // The hyphen in "Pre‑flight" is U+2011 in the engine's log — match loosely.
  if (!/Pre.?flight build completed/.test(secondOut)) {
    fail(
      "second real sync did not run the live preflight build — the idempotence row would prove less than it claims",
      secondOut,
    );
  }
  if (!secondOut.includes("Total ops : 0")) {
    fail(
      "second real sync reported nonzero ops on a converged tree (truthful-counts regression on the real path)",
      secondOut,
    );
  }
  const idemPorcelain = projSh("git status --porcelain");
  if (idemPorcelain.trim() !== "") {
    fail(
      "second real sync is not byte-idempotent (RCA #5 gate row 3)",
      idemPorcelain,
    );
  }
  const afterIdem = snapshotTreeWithDirs(proj, idemSkip);
  if (JSON.stringify(afterIdem) !== JSON.stringify(beforeIdem)) {
    const beforeSet = new Set(beforeIdem);
    const afterSet = new Set(afterIdem);
    fail(
      "second real sync changed the tree outside build outputs",
      `added:\n${afterIdem.filter((e) => !beforeSet.has(e)).join("\n") || "(none)"}\nremoved:\n${beforeIdem.filter((e) => !afterSet.has(e)).join("\n") || "(none)"}`,
    );
  }
  step("Second real sync byte-idempotent (porcelain + tree snapshot) ✅");

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
