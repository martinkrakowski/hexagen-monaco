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
 *   orchestration (OW7, fixtures that install the orchestration template —
 *                 minimal-addons). Hard gates, each a red/green pair run
 *                 against the PACKED @hexagen-monaco/orchestration tarball:
 *                   orch:gate.yml-emitted                   absent without the template (a twin
 *                                                           generated with --omit=orchestration),
 *                                                           present and scanned by workflows +
 *                                                           actionlint with it.
 *                   orch:package-files                      every `bin` target and the wave-status
 *                                                           page is in the installed package.
 *                   orch:doctor-no-overlay                  red: doctor before init → exit 2.
 *                   orch:init-scaffold                      first init scaffolds the overlay.
 *                   orch:config-repo-placeholder            the scaffolded config has the repo
 *                                                           placeholder; it is seeded with a repo.
 *                   orch:init-idempotent                    second init, after the seed: seed survives,
 *                                                           every scaffold file reported kept,
 *                                                           tree byte-identical.
 *                   orch:doctor-ci-workflow                 red: ci.yml removed → FAIL naming it;
 *                                                           restored → no FAIL.
 *                   orch:doctor-override                    red: an override without a reason →
 *                                                           FAIL `overrides[0].reason is required`.
 *                   orch:doctor-invariant-drift             red: an invariant off its locked default
 *                                                           with no overrides[] entry → FAIL.
 *                   orch:doctor-override-unknown-invariant  red: overrides[].invariant outside the
 *                                                           closed set → FAIL; restored → exit 0.
 *                   orch:doctor-green                       configured project → exit 0.
 *                   orch:print-steps-mutate                 mutate false omits mutate +
 *                                                           verify-manifests; true keeps them.
 *                   orch:gate-runs                          real gate run: a failing step exits
 *                                                           with its own code (3), naming the step;
 *                                                           a passing list exits 0.
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
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
  { short: "orchestration", dir: "tools/orchestration" },
];
// Tooling the generator itself emits a devDependency range for (RCA #1 pin
// gate). orchestration is NOT in this set: no generator emits its range — the
// template's checklist is `yarn add -D @hexagen-monaco/orchestration` — so the
// harness performs that step, with the packed version, for the fixtures that
// install the template.
const PIN_CHECKED = ["sync", "arch-linter"];
const ORCH = "orchestration";
// Fixtures whose add-on answers include the orchestration template.
const ORCH_FIXTURES = ["minimal-addons"];
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
    " --filter=@hexagen/orchestration" +
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
step("Packed @hexagen-monaco/{sync,arch-linter,orchestration}");

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
    for (const short of PIN_CHECKED) {
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
  const hasOrch = ORCH_FIXTURES.includes(fixture);
  if (hasOrch) {
    // The template's checklist step 1 (`yarn add -D …`), done by the harness:
    // the devDependency is aligned with OW-D1 (published name), its range is the
    // packed version, and the resolution swaps in the tarball — same hermetic
    // mechanism as sync/arch-linter.
    pkg.devDependencies = {
      ...pkg.devDependencies,
      [`@hexagen-monaco/${ORCH}`]: `^${packedVersion[ORCH]}`,
    };
    pkg.resolutions[`@hexagen-monaco/${ORCH}`] = `file:${tarball[ORCH]}`;
  }
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
            throw new Error(`${wf}: job ${jobName}: live \`cache: ${cache}\``);
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

  // -- orchestration (OW7) --------------------------------------------------
  // Hard gates against the PACKED package, in the generated project. Each red
  // asserts the failure it claims (exit code AND the named cause), then the
  // state is restored and the green is asserted — "a gate that has not been
  // shown to fail has not been shown to exist" (plan §7).
  if (hasOrch) {
    const ORCH_DIR = ".agents/orchestration";
    const CONFIG = path.join(proj, ORCH_DIR, "config.yaml");
    // Run a bin from the project's own node_modules/.bin WITHOUT throwing, so a
    // red can assert its exit code and output.
    const run = (cmd) => {
      const r = spawnSync(cmd, {
        cwd: proj,
        shell: true,
        encoding: "utf8",
        env: { ...process.env },
      });
      return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    const expect = (cond, msg) => {
      if (!cond) throw new Error(msg);
    };
    const hashTree = (rel) => {
      const out = {};
      const walk = (dir) => {
        for (const name of readdirSync(dir).sort()) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else
            out[path.relative(proj, full)] = createHash("sha256")
              .update(readFileSync(full))
              .digest("hex");
        }
      };
      walk(path.join(proj, rel));
      return JSON.stringify(out);
    };

    // gate.yml: absent without the template, present with it — and it is the
    // REAL emitted file the workflows (F21) and actionlint gates above just ran
    // over (they scan every file in .github/workflows).
    gate("orch:gate.yml-emitted", () => {
      const twin = mkdtempSync(path.join(tmpdir(), "capstone-gate-noorch-"));
      cleanup.push(() => rmSync(twin, { recursive: true, force: true }));
      sh(
        `yarn tsx scripts/capstone/generate-fixture.ts ${fixture} "${twin}" --omit=${ORCH}`,
      );
      expect(
        !existsSync(path.join(twin, ".github/workflows/gate.yml")),
        "gate.yml exists WITHOUT the orchestration template (red side broke)",
      );
      const emitted = path.join(proj, ".github/workflows/gate.yml");
      expect(
        existsSync(emitted),
        "gate.yml missing WITH the orchestration template",
      );
      expect(
        readFileSync(emitted, "utf8").includes("hexagen-orchestration-gate"),
        "gate.yml does not run hexagen-orchestration-gate",
      );
      // node_version is auto-derived from ci-github-actions: no unresolved token.
      expect(
        !/\{node_version\}/.test(readFileSync(emitted, "utf8")),
        "gate.yml still contains an uninterpolated {node_version}",
      );
    });

    // Every declared bin target, and the wave-status page, must be in the
    // installed package: the tarball is what users get.
    gate("orch:package-files", () => {
      const pdir = path.join(proj, "node_modules/@hexagen-monaco", ORCH);
      const pj = JSON.parse(
        readFileSync(path.join(pdir, "package.json"), "utf8"),
      );
      const missing = Object.entries(pj.bin)
        .filter(([, target]) => !existsSync(path.join(pdir, target)))
        .map(([name, target]) => `${name} -> ${target}`);
      for (const rel of ["bin/gate-run.sh", "public/wave-status/index.html"]) {
        if (!existsSync(path.join(pdir, rel))) missing.push(rel);
      }
      expect(
        missing.length === 0,
        `installed @hexagen-monaco/${ORCH} is missing: ${missing.join(", ")}`,
      );
    });

    // Red: no overlay yet → doctor exits 2 naming the missing config.
    gate("orch:doctor-no-overlay", () => {
      const r = run("node_modules/.bin/hexagen-orchestration-doctor");
      expect(
        r.status === 2,
        `doctor before init: expected exit 2, got ${r.status}\n${r.out}`,
      );
      expect(
        r.out.includes(`no overlay at ${ORCH_DIR}/config.yaml`),
        `doctor before init did not name the missing config\n${r.out}`,
      );
    });

    // First init scaffolds the overlay.
    const inited = gate("orch:init-scaffold", () => {
      const first = run("node_modules/.bin/hexagen-orchestration-init");
      expect(
        first.status === 0,
        `init (1st) exit ${first.status}\n${first.out}`,
      );
      expect(existsSync(CONFIG), "init did not scaffold config.yaml");
    });

    // The generated project is not hexagen and has no GitHub remote, so the
    // loader cannot derive `repo` (gh). Seed it the way an operator would. A
    // missing placeholder is a named FAIL row, not a throw past the summary.
    let configured;
    const marker = /^# repo: \(derive it.*$/m;
    const seeded =
      inited &&
      gate("orch:config-repo-placeholder", () => {
        const scaffolded = readFileSync(CONFIG, "utf8");
        expect(
          marker.test(scaffolded),
          "scaffolded config.yaml has no repo placeholder",
        );
        configured = scaffolded.replace(
          marker,
          'repo: "capstone/vellum-minimal"',
        );
      });

    if (seeded) {
      const setConfig = (text) => writeFileSync(CONFIG, text);
      setConfig(configured);

      // init twice (F-14): a second run is a SKIP, not a rewrite. It runs AFTER
      // the repo seed above, so a deterministic init that overwrote its
      // scaffold would erase the seed and fail here; a byte-identical hash
      // alone could not tell the two apart.
      gate("orch:init-idempotent", () => {
        const before = hashTree(ORCH_DIR) + hashTree(".lane");
        const second = run("node_modules/.bin/hexagen-orchestration-init");
        expect(
          second.status === 0,
          `init (2nd) exit ${second.status}\n${second.out}`,
        );
        expect(
          readFileSync(CONFIG, "utf8") === configured,
          "second init overwrote the seeded config.yaml",
        );
        expect(
          second.out.includes("wrote 0, left 5 untouched") &&
            !/^created /m.test(second.out),
          `second init did not report every scaffold file as kept\n${second.out}`,
        );
        expect(
          hashTree(ORCH_DIR) + hashTree(".lane") === before,
          "second init changed the scaffolded tree",
        );
      });

      // Red: the configured ciWorkflow is missing → FAIL naming the file.
      // (Spec §7 OW3 doctor red; the fixture installs ci-github-actions, which
      // provides ci.yml, so the green side is the real emitted file.)
      gate("orch:doctor-ci-workflow", () => {
        const ci = path.join(proj, ".github/workflows/ci.yml");
        expect(existsSync(ci), "ci-github-actions did not emit ci.yml");
        const aside = `${ci}.aside`;
        renameSync(ci, aside);
        let red;
        try {
          red = run("node_modules/.bin/hexagen-orchestration-doctor");
        } finally {
          renameSync(aside, ci);
        }
        expect(
          red.status === 1,
          `doctor without ci.yml: expected exit 1, got ${red.status}\n${red.out}`,
        );
        expect(
          red.out.includes("ci-workflow") &&
            red.out.includes(".github/workflows/ci.yml"),
          `doctor did not name the missing ci.yml\n${red.out}`,
        );
      });

      // Red: an override with no `reason` fails validation.
      gate("orch:doctor-override", () => {
        setConfig(
          configured.replace(
            "invariants:",
            "overrides:\n  - invariant: eventDuty\ninvariants:",
          ),
        );
        let red;
        try {
          red = run("node_modules/.bin/hexagen-orchestration-doctor");
        } finally {
          setConfig(configured);
        }
        expect(
          red.status === 1,
          `doctor with reasonless override: expected exit 1, got ${red.status}\n${red.out}`,
        );
        expect(
          red.out.includes("overrides[0].reason is required"),
          `doctor did not name overrides[0].reason as required\n${red.out}`,
        );
      });

      // Red (spec §7): an invariant moved off its locked default with no
      // overrides[] entry naming it. Restored, doctor is green again.
      gate("orch:doctor-invariant-drift", () => {
        expect(
          configured.includes("  eventDuty: true"),
          "scaffolded config.yaml has no `eventDuty: true` to flip",
        );
        setConfig(
          configured.replace("  eventDuty: true", "  eventDuty: false"),
        );
        let red;
        try {
          red = run("node_modules/.bin/hexagen-orchestration-doctor");
        } finally {
          setConfig(configured);
        }
        expect(
          red.status === 1,
          `doctor with a drifted invariant: expected exit 1, got ${red.status}\n${red.out}`,
        );
        expect(
          red.out.includes(
            "invariants.eventDuty differs from its locked default (true) with no overrides[] entry naming it",
          ),
          `doctor did not name the un-overridden invariant drift\n${red.out}`,
        );
        const green = run("node_modules/.bin/hexagen-orchestration-doctor");
        expect(
          green.status === 0,
          `doctor after restoring the invariant: exit ${green.status}\n${green.out}`,
        );
      });

      // Red (spec §7): an overrides[].invariant outside the closed set
      // {statusSource, eventDuty, mergeRequiresGreenGate, attribution}.
      gate("orch:doctor-override-unknown-invariant", () => {
        setConfig(
          configured.replace(
            "invariants:",
            "overrides:\n  - invariant: notAnInvariant\n    reason: the capstone red\ninvariants:",
          ),
        );
        let red;
        try {
          red = run("node_modules/.bin/hexagen-orchestration-doctor");
        } finally {
          setConfig(configured);
        }
        expect(
          red.status === 1,
          `doctor with an unknown override invariant: expected exit 1, got ${red.status}\n${red.out}`,
        );
        expect(
          red.out.includes(
            'overrides[0].invariant "notAnInvariant" is not one of: statusSource, eventDuty, mergeRequiresGreenGate, attribution',
          ),
          `doctor did not name the unknown override invariant\n${red.out}`,
        );
        const green = run("node_modules/.bin/hexagen-orchestration-doctor");
        expect(
          green.status === 0,
          `doctor after restoring the overrides: exit ${green.status}\n${green.out}`,
        );
      });

      // Green: the configured project is healthy.
      gate("orch:doctor-green", () => {
        const g = run("node_modules/.bin/hexagen-orchestration-doctor");
        expect(
          g.status === 0,
          `doctor on a configured project: exit ${g.status}\n${g.out}`,
        );
      });

      // `mutate` toggles whether mutate + verify-manifests are in the gate.
      gate("orch:print-steps-mutate", () => {
        const withMutators = configured.replace(
          "gateSteps:\n",
          "gateSteps:\n  - name: mutate\n    command: npx --no-install hexagen-orchestration-mutate\n" +
            "  - name: verify-manifests\n    command: npx --no-install hexagen-orchestration-verify-manifests\n",
        );
        const steps = (mutateOn) => {
          setConfig(
            withMutators.replace(/^mutate: .*$/m, `mutate: ${mutateOn}`),
          );
          const r = run(
            "node_modules/.bin/hexagen-orchestration-gate --print-steps",
          );
          expect(
            r.status === 0,
            `--print-steps (mutate ${mutateOn}) exit ${r.status}\n${r.out}`,
          );
          return r.out;
        };
        try {
          const off = steps(false);
          expect(
            !/mutate|verify-manifests/.test(off) && /build/.test(off),
            `mutate: false must omit mutate + verify-manifests:\n${off}`,
          );
          const on = steps(true);
          expect(
            /^mutate\t/m.test(on) && /^verify-manifests\t/m.test(on),
            `mutate: true must include mutate + verify-manifests:\n${on}`,
          );
        } finally {
          setConfig(configured);
        }
      });

      // A real gate run, through the packaged gate-run.sh: a failing step exits
      // non-zero and is named; an all-passing list exits 0.
      gate("orch:gate-runs", () => {
        const withSteps = (steps) =>
          configured.replace(
            /gateSteps:\n(?:  .*\n|    .*\n)+/,
            `gateSteps:\n${steps.map((st) => `  - name: ${st.name}\n    command: ${JSON.stringify(st.command)}\n`).join("")}`,
          );
        try {
          setConfig(
            withSteps([
              { name: "fine", command: "node -e 0" },
              { name: "boom", command: 'node -e "process.exit(3)"' },
            ]),
          );
          const red = run("node_modules/.bin/hexagen-orchestration-gate");
          expect(
            red.status !== 0,
            `gate with a failing step exited 0\n${red.out}`,
          );
          // gate-run.sh must hand the step's own exit code back verbatim: 3, not
          // the 1 a shell syntax error would give.
          expect(
            red.status === 3,
            `gate with a step exiting 3: expected exit 3, got ${red.status}\n${red.out}`,
          );
          expect(
            red.out.includes("boom"),
            `gate did not name the failing step\n${red.out}`,
          );
          setConfig(withSteps([{ name: "fine", command: "node -e 0" }]));
          const green = run("node_modules/.bin/hexagen-orchestration-gate");
          expect(
            green.status === 0,
            `gate with only passing steps: exit ${green.status}\n${green.out}`,
          );
        } finally {
          setConfig(configured);
        }
      });
    }
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
