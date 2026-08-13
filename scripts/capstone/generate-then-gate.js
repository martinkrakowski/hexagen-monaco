#!/usr/bin/env node
/**
 * Capstone — generate-then-gate (vellum findings harness, plan §5.2).
 *
 * first-run-green.js proves the bare scaffold + installed tooling contract.
 * This harness proves the WIZARD-SHAPED projects work first-run: fixtures are
 * built at runtime from scripted wizard answers via `wizardToManifest()` and
 * the real external-mode SyncEngine (scripts/capstone/generate-fixture.ts), so
 * every emission default is under test — no static fixture manifests to rot.
 *
 * Fixtures (see generate-fixture.ts):
 *   monolith-15     15 bounded contexts + shared, Next.js web + Nitro api.
 *   minimal-addons  1 context + 5 add-on templates.
 *
 * Hard gates per fixture (any failure → exit 1, run continues to collect all):
 *   install       corepack + yarn install (after the first-run-green pin gate
 *                 + tarball resolutions — same hermetic setup as the chassis).
 *   build         `yarn build` (turbo) — F15's turbo.json is live here.
 *   typecheck     `yarn typecheck` — F2's tsconfig include:["src"].
 *   lint          `yarn lint` (turbo).
 *   test          `yarn test` (turbo → vitest --passWithNoTests).
 *   lint:arch     `yarn lint:arch` (installed hexagen bin).
 *   lint:ws       `yarn workspace <ctx> lint` WITHOUT turbo — F8: a workspace
 *                 must be lintable standalone, its own devDeps sufficing.
 *   sync:check    installed `hexagen sync --check --allow-dirty` → exit 0 AND
 *                 `Total ops : 0` (manifest round-trip + F15 determinism).
 *   env-staged    F3: every on-disk `.env*.example` is visible to git after
 *                 `git add -A` (the generated .gitignore must re-include them).
 *   workflows     F21: every emitted workflow using setup-node enables
 *                 Corepack FIRST, sets `package-manager-cache: false`, and has
 *                 no live `cache: yarn`.
 *   actionlint    actionlint over the emitted workflows (skips with a notice
 *                 when the binary is absent — CI installs it).
 *
 * Advisory rows (reported, never fail the run — open findings F5/F6/F7, F9,
 * F19 are surfaced here and flip to hard gates when fixed):
 *   import-probe  cross-package import of the shared kernel typechecks.
 *   orphans       add-on files landing outside every workspace (F9).
 *   no-console    eslint.no-console.mjs is actually referenced by a config.
 *
 * Usage: node scripts/capstone/generate-then-gate.js [--fixture=<name>|all]
 *        (yarn capstone:gate)
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { parse as parseYaml } from "yaml";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const FIXTURES = ["minimal-addons", "monolith-15"];
// On-disk `.env*.example` files each fixture is EXPECTED to carry (F3):
// minimal-addons materializes env-setup + bullmq + rate-limiting examples;
// monolith-15 has no add-ons, so the row degenerates to staged==on-disk==0.
const EXPECTED_ENV_EXAMPLES = { "minimal-addons": 3, "monolith-15": 0 };

const arg = process.argv.find((a) => a.startsWith("--fixture="));
const selected = arg ? arg.slice("--fixture=".length) : "all";
const fixtures = selected === "all" ? FIXTURES : [selected];
for (const f of fixtures) {
  if (!FIXTURES.includes(f)) {
    console.error(`unknown fixture '${f}' (choose ${FIXTURES.join("|")}|all)`);
    process.exit(1);
  }
}

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
const step = (msg) => console.log(`• ${msg}`);
const results = []; // { fixture, gate, status: PASS|FAIL|ADVISORY|SKIP, note }
const record = (fixture, gate, status, note = "") => {
  results.push({ fixture, gate, status, note });
  const icon =
    status === "PASS"
      ? "✅"
      : status === "FAIL"
        ? "❌"
        : status === "SKIP"
          ? "⏭️"
          : "⚠️";
  console.log(`  ${icon} [${fixture}] ${gate}${note ? ` — ${note}` : ""}`);
};
const errText = (e) =>
  (String(e?.stdout ?? "") + String(e?.stderr ?? "")).trim() || String(e);
// Keep failure detail readable in CI logs without drowning the summary.
const tail = (s, lines = 40) => s.split("\n").slice(-lines).join("\n");

// ---------------------------------------------------------------------------
// 1+2. Build the tooling (and the packages the fixture helper imports by
//      name) + pack the tarballs — same recipe as first-run-green.js.
// ---------------------------------------------------------------------------
step("Building tooling + fixture-helper packages…");
sh(
  "yarn turbo run build --filter=@hexagen/sync --filter=@hexagen/arch-linter" +
    " --filter=@hexagen/project-configuration --filter=@hexagen/template-engine",
);

const packDir = mkdtempSync(path.join(tmpdir(), "capstone-gate-pack-"));
cleanup.push(() => rmSync(packDir, { recursive: true, force: true }));
const tarball = {};
const packedVersion = {};
for (const { short, dir } of PACKAGES) {
  const version = pkgVersion(dir);
  packedVersion[short] = version;
  const publishDir = path.join(REPO, dir, "publish");
  try {
    sh(`node scripts/prepare-publish-package.js ${dir}`);
    sh(`npm pack --pack-destination "${packDir}"`, { cwd: publishDir });
  } finally {
    rmSync(publishDir, { recursive: true, force: true });
  }
  tarball[short] = path.join(packDir, `hexagen-monaco-${short}-${version}.tgz`);
}
step("Packed @hexagen-monaco/{sync,arch-linter}");

const haveActionlint = (() => {
  try {
    sh("actionlint -version");
    return true;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Per-fixture pipeline.
// ---------------------------------------------------------------------------
let hardFailure = false;

for (const fixture of fixtures) {
  console.log(`\n=== fixture: ${fixture} ===`);
  const proj = mkdtempSync(path.join(tmpdir(), `capstone-gate-${fixture}-`));
  cleanup.push(() => rmSync(proj, { recursive: true, force: true }));

  const projSh = (cmd) =>
    execSync(cmd, {
      cwd: proj,
      stdio: "pipe",
      encoding: "utf8",
      env: {
        ...process.env,
        // First install of a freshly generated project — no lockfile yet
        // (same documented first-run case first-run-green.js handles).
        YARN_ENABLE_HARDENED_MODE: "0",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
      },
    });
  // A hard gate: run `fn`, record PASS/FAIL. Returns true on pass.
  const gate = (name, fn) => {
    try {
      fn();
      record(fixture, name, "PASS");
      return true;
    } catch (e) {
      hardFailure = true;
      record(fixture, name, "FAIL", tail(errText(e)).split("\n")[0] ?? "");
      console.error(tail(errText(e)));
      return false;
    }
  };
  const advisory = (name, fn) => {
    try {
      const note = fn();
      record(fixture, name, "PASS", typeof note === "string" ? note : "");
    } catch (e) {
      record(fixture, name, "ADVISORY", tail(errText(e), 6));
    }
  };

  // Generate — wizard answers → manifest → external SyncEngine → add-ons.
  if (
    !gate("generate", () =>
      sh(`yarn tsx scripts/capstone/generate-fixture.ts ${fixture} "${proj}"`),
    )
  ) {
    continue; // nothing downstream can run
  }

  // Pin gate (RCA #1, mirrored from first-run-green): the emitted tooling
  // ranges must be satisfied by the packed versions BEFORE resolutions mask
  // any skew.
  const pkgPath = path.join(proj, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const pinOk = gate("pin-gate", () => {
    for (const { short } of PACKAGES) {
      const name = `@hexagen-monaco/${short}`;
      const range = pkg.devDependencies?.[name];
      if (!range) throw new Error(`root package.json missing ${name}`);
      if (!semver.satisfies(packedVersion[short], range)) {
        throw new Error(
          `emitted ${name}@${range} not satisfied by packed ${packedVersion[short]}`,
        );
      }
    }
  });
  if (!pinOk) continue;
  pkg.resolutions = {
    "@hexagen-monaco/sync": `file:${tarball.sync}`,
    "@hexagen-monaco/arch-linter": `file:${tarball["arch-linter"]}`,
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  // Install.
  const installed = gate("install", () => {
    projSh("corepack enable");
    const pm =
      typeof pkg.packageManager === "string"
        ? pkg.packageManager
        : "yarn@4.12.0";
    projSh(`corepack prepare ${pm} --activate`);
    projSh("yarn install");
  });
  if (!installed) continue;

  // Baseline commit. `git add -A` INSIDE the throwaway fixture is deliberate
  // and itself under test: F3 is precisely about what the generated
  // .gitignore lets a bulk add stage.
  projSh("git init -q");
  projSh("git add -A");
  projSh(
    'git -c user.email=capstone@test.invalid -c user.name="Capstone" commit -q -m baseline',
  );

  // The turbo gates — turbo.json here is the F15 turboConfig emission.
  gate("build", () => projSh("yarn build"));
  gate("typecheck", () => projSh("yarn typecheck"));
  gate("lint", () => projSh("yarn lint"));
  gate("test", () => projSh("yarn test"));
  gate("lint:arch", () => projSh("yarn lint:arch"));

  // F8 — standalone (non-turbo) workspace lint. Pick the first bounded-
  // context workspace (not shared: contexts are what users extend first).
  const contextDirs = readdirSync(path.join(proj, "packages")).filter(
    (d) => d !== "shared",
  );
  const wsName = (d) =>
    JSON.parse(
      readFileSync(path.join(proj, "packages", d, "package.json"), "utf8"),
    ).name;
  const firstCtx = wsName(contextDirs[0]);
  gate("lint:ws (F8)", () => projSh(`yarn workspace ${firstCtx} lint`));

  // Convergence: the installed CLI must see zero pending ops against the
  // emitted manifest (round-trip + F15 determinism). --allow-dirty: build
  // outputs and the probe/report churn are irrelevant to the claim.
  gate("sync:check", () => {
    const out = projSh("node_modules/.bin/hexagen sync --check --allow-dirty");
    if (!out.includes("Total ops : 0")) {
      throw new Error(`sync --check did not report Total ops : 0\n${out}`);
    }
  });

  // F3 — every on-disk `.env*.example` must be staged by the baseline
  // `git add -A` above (the generated .gitignore re-includes them).
  gate("env-staged (F3)", () => {
    const onDisk = readdirSync(proj).filter(
      (f) => f.startsWith(".env") && f.endsWith(".example"),
    );
    const staged = projSh("git ls-files")
      .split("\n")
      .filter((f) => /^\.env.*\.example$/.test(f));
    const expected = EXPECTED_ENV_EXAMPLES[fixture];
    if (onDisk.length !== expected) {
      throw new Error(
        `expected ${expected} on-disk .env*.example, found ${onDisk.length}: ${onDisk.join(", ")}`,
      );
    }
    if (staged.length !== onDisk.length) {
      throw new Error(
        `gitignore swallowed env examples: on-disk [${onDisk.join(", ")}] vs staged [${staged.join(", ")}]`,
      );
    }
  });

  // F21 — emitted workflow hygiene: corepack before setup-node, the v5 cache
  // auto-probe disabled, no live `cache: yarn`. Validated PER JOB from the
  // parsed YAML, not whole-file string scans — a document-wide match would let
  // one job's `corepack enable` or `package-manager-cache: false` vouch for a
  // setup-node step in a DIFFERENT job.
  gate("workflows (F21)", () => {
    const wfDir = path.join(proj, ".github", "workflows");
    const workflows = existsSync(wfDir)
      ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f))
      : [];
    if (workflows.length === 0) throw new Error("no emitted workflows found");
    for (const wf of workflows) {
      const doc = parseYaml(readFileSync(path.join(wfDir, wf), "utf8"));
      for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
        let corepackSeen = false;
        for (const step of job?.steps ?? []) {
          if (
            typeof step?.run === "string" &&
            step.run.includes("corepack enable")
          ) {
            corepackSeen = true;
          }
          const cache = step?.with?.cache;
          if (typeof cache === "string" && cache.startsWith("yarn")) {
            throw new Error(
              `${wf}: job ${jobName}: live \`cache: ${cache}\``,
            );
          }
          if (
            typeof step?.uses === "string" &&
            step.uses.startsWith("actions/setup-node@")
          ) {
            if (!corepackSeen) {
              throw new Error(
                `${wf}: job ${jobName}: corepack enable must precede setup-node`,
              );
            }
            if (step.with?.["package-manager-cache"] !== false) {
              throw new Error(
                `${wf}: job ${jobName}: setup-node@v5 needs package-manager-cache: false`,
              );
            }
          }
        }
      }
    }
  });

  // actionlint over the emitted workflows (CI installs the binary).
  if (haveActionlint) {
    // No args: actionlint discovers .github/workflows itself. External
    // shellcheck/pyflakes are disabled — only workflow semantics are gated.
    gate("actionlint", () => projSh("actionlint -shellcheck= -pyflakes="));
  } else {
    record(fixture, "actionlint", "SKIP", "actionlint binary not on PATH");
  }

  // -- Advisory rows (open findings; flip to `gate(...)` when fixed) --------

  // F5/F6/F7 — a bounded context importing the shared kernel must typecheck.
  advisory("import-probe (F5/F6/F7)", () => {
    const sharedPkg = JSON.parse(
      readFileSync(
        path.join(proj, "packages", "shared", "package.json"),
        "utf8",
      ),
    ).name;
    const probe = path.join(
      proj,
      "packages",
      contextDirs[0],
      "src",
      "capstone-import-probe.ts",
    );
    writeFileSync(
      probe,
      `import * as shared from "${sharedPkg}";\n` +
        `export const sharedProbe: string = typeof shared;\n`,
    );
    try {
      projSh(`yarn workspace ${firstCtx} typecheck`);
    } finally {
      rmSync(probe, { force: true });
    }
    return `import of ${sharedPkg} typechecks`;
  });

  // F9 — add-on files outside every workspace compile/lint nowhere.
  advisory("orphans (F9)", () => {
    const orphanDirs = ["src", "server", "app", "scripts", "types"].filter(
      (d) => existsSync(path.join(proj, d)),
    );
    const count = orphanDirs.length;
    if (count > 0) {
      throw new Error(
        `root-level non-workspace source dirs (uncovered by any tsconfig/eslint): ${orphanDirs.join(", ")}`,
      );
    }
    return "no orphan source dirs at root";
  });

  // F19 — the dropped eslint.no-console.mjs must actually be wired up.
  advisory("no-console wiring (F19)", () => {
    const dropped = existsSync(path.join(proj, "eslint.no-console.mjs"));
    if (!dropped) return "add-on not selected for this fixture";
    const referenced = projSh(
      'grep -rl "eslint.no-console" --include="eslint.config.*" . || true',
    ).trim();
    if (!referenced) {
      throw new Error(
        "eslint.no-console.mjs exists but no eslint.config.* references it",
      );
    }
    return "referenced by an eslint config";
  });
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
console.log("\n=== generate-then-gate summary ===");
const pad = (s, n) => String(s).padEnd(n);
for (const r of results) {
  console.log(
    `${pad(r.fixture, 16)} ${pad(r.gate, 24)} ${pad(r.status, 9)} ${r.note}`,
  );
}

for (const fn of cleanup) {
  try {
    fn();
  } catch {
    /* best effort */
  }
}

if (hardFailure) {
  console.error("\n❌ GENERATE-THEN-GATE FAILED (see gates above)");
  process.exit(1);
}
console.log(
  "\n✅ GENERATE-THEN-GATE PASSED — wizard-shaped projects are first-run green" +
    " (advisory rows may list open findings).",
);
