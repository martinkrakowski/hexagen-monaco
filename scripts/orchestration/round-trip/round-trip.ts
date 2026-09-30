/* eslint-disable no-console */
/**
 * OW8 — the hexagen-side round trip of the orchestration template (plan §5 row OW8, §7, §12 A-10,
 * A-16, A-17, §12.4 §8).
 *
 * It generates a fixture project at run time, installs the `orchestration` template into it the way
 * `hexagen add` does (AddTemplateUseCase, in-process, the FILESYSTEM emitter and the DISK config
 * store — never the in-memory materializer, A-16), installs `@hexagen-monaco/orchestration` from the
 * tarball OW7 packs, seeds the overlay, runs `init` and `doctor`, reinstalls with force, and then
 * makes three hard checks: (a) coverage, (b) steps, (c) stability. Every check has a red that is
 * shown to fail before its green is believed.
 *
 *   yarn tsx scripts/orchestration/round-trip/round-trip.ts
 *
 * Exit 0 only when every named assertion holds. The fixture, the packed tarballs and the pinned
 * PATH all live in temp directories that are removed on exit, even on an uncaught error. It does
 * write outside them: turbo build outputs in the repo (`dist/`, `.turbo/`, both gitignored), a
 * transient `<pkg>/publish/` per packed package (removed in a `finally`), and
 * `corepack prepare --activate` touches the host corepack state.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AddTemplateUseCase,
  FileSystemFileEmitter,
  FileSystemTemplateConfigStore,
  FileSystemTemplateRegistry,
} from "../../../packages/template-engine/src/index.js";
import type {
  QuestionEnginePort,
  TemplateConfig,
} from "../../../packages/template-engine/src/index.js";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const TEMPLATES_DIR = path.join(REPO, "packages/template-engine/templates");
const FIXTURE = path.join(
  REPO,
  "packages/template-engine/__tests__/fixtures/orchestration",
);
const CF = path.join(FIXTURE, "campaign-foundry");
const ORCH_DIR = ".agents/orchestration";
const SKILL_DIR = ".agents/skills/orchestrate-wave";
const CONFIG_FILE = ".hexagen-template-config.json";
const ORCH = "orchestration";

// ---------------------------------------------------------------------------
// Assertion plumbing: every assertion is named, and a failed one does not stop
// the run, so one report shows everything that is wrong.
// ---------------------------------------------------------------------------
let failures = 0;
const cleanup: Array<() => void> = [];

function step(msg: string): void {
  console.log(`\n• ${msg}`);
}

function check(name: string, fn: () => void): boolean {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    return true;
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}`);
    console.log(
      String((e as Error).message)
        .split("\n")
        .map((l) => `        ${l}`)
        .join("\n"),
    );
    return false;
  }
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const tail = (s: string, n = 30): string => s.split("\n").slice(-n).join("\n");

interface Ran {
  status: number | null;
  out: string;
  stdout: string;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Ran {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO,
    env: opts.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return {
    status: r.status,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    stdout: r.stdout ?? "",
  };
}

function sh(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  const r = run(cmd, args, { cwd, env });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${r.status}\n${tail(r.out)}`,
    );
  }
  return r.out;
}

// ---------------------------------------------------------------------------
// Pure helpers: the three comparators, exported through the red cases below.
// ---------------------------------------------------------------------------

/** sha256 of every file under `dir`, as sorted `hash  relative/path` lines. */
function hashList(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const h = createHash("sha256").update(readFileSync(full)).digest("hex");
        out.push(`${h}  ${path.relative(root, full)}`);
      }
    }
  };
  walk(path.join(root, dir));
  return out;
}

/** The first difference between two hash lists, or undefined when identical. */
function firstHashDiff(a: string[], b: string[]): string | undefined {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i])
      return `line ${i + 1}: ${a[i] ?? "(none)"} vs ${b[i] ?? "(none)"}`;
  }
  return undefined;
}

/** Line-for-line comparison of two step listings; names the first difference. */
function firstLineDiff(actual: string, expected: string): string | undefined {
  const a = actual.split("\n");
  const e = expected.split("\n");
  const n = Math.max(a.length, e.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== e[i]) {
      return `line ${i + 1}: got ${JSON.stringify(a[i])}, expected ${JSON.stringify(e[i])}`;
    }
  }
  return undefined;
}

const linesOf = (file: string): string[] =>
  readFileSync(file, "utf8").split("\n");

// ---------------------------------------------------------------------------
// 0. Build + pack. Same recipe as scripts/capstone/generate-then-gate.js (which
//    has top-level side effects and cannot be imported, and which OW8 must not
//    edit), reduced to the three packages the fixture needs.
// ---------------------------------------------------------------------------
try {
  step(
    "Build the tooling and pack @hexagen-monaco/{sync,arch-linter,orchestration}",
  );
  sh(
    "yarn",
    [
      "turbo",
      "run",
      "build",
      "--filter=@hexagen/sync",
      "--filter=@hexagen/arch-linter",
      "--filter=@hexagen/orchestration",
    ],
    REPO,
  );
  const packDir = mkdtempSync(path.join(tmpdir(), "orch-rt-pack-"));
  cleanup.push(() => rmSync(packDir, { recursive: true, force: true }));
  const PACKAGES = [
    { short: "sync", dir: "packages/sync" },
    { short: "arch-linter", dir: "tools/arch-linter" },
    { short: "orchestration", dir: "tools/orchestration" },
  ];
  const tarball: Record<string, string> = {};
  for (const { short, dir } of PACKAGES) {
    const version = JSON.parse(
      readFileSync(path.join(REPO, dir, "package.json"), "utf8"),
    ).version as string;
    const publishDir = path.join(REPO, dir, "publish");
    try {
      sh("node", ["scripts/prepare-publish-package.js", dir], REPO);
      sh("npm", ["pack", "--pack-destination", packDir], publishDir);
    } finally {
      rmSync(publishDir, { recursive: true, force: true });
    }
    tarball[short] = path.join(
      packDir,
      `hexagen-monaco-${short}-${version}.tgz`,
    );
    check(`packed ${short}@${version}`, () =>
      expect(existsSync(tarball[short]), `${tarball[short]} missing`),
    );
  }

  // ---------------------------------------------------------------------------
  // 1. Generate a fixture project, WITHOUT the orchestration add-on (the harness
  //    would otherwise materialize it in memory, which is the A-16 trap), and
  //    prove the project has no template record and none of the template's files.
  // ---------------------------------------------------------------------------
  step("Generate the fixture project (minimal-addons --omit=orchestration)");
  const proj = mkdtempSync(path.join(tmpdir(), "orch-rt-proj-"));
  cleanup.push(() => rmSync(proj, { recursive: true, force: true }));
  const envHarness: NodeJS.ProcessEnv = {
    ...process.env,
    // First install of a freshly generated project: no lockfile yet (same
    // documented first-run case the capstone handles).
    YARN_ENABLE_HARDENED_MODE: "0",
    YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
  };
  sh(
    "yarn",
    [
      "tsx",
      "scripts/capstone/generate-fixture.ts",
      "minimal-addons",
      proj,
      `--omit=${ORCH}`,
    ],
    REPO,
  );
  check(`before: no ${CONFIG_FILE}`, () =>
    expect(!existsSync(path.join(proj, CONFIG_FILE)), `${CONFIG_FILE} exists`),
  );
  check(
    "before: no .github/workflows/gate.yml (nothing installed orchestration in memory)",
    () =>
      expect(
        !existsSync(path.join(proj, ".github/workflows/gate.yml")),
        "gate.yml exists",
      ),
  );
  check(`before: no ${SKILL_DIR}/`, () =>
    expect(!existsSync(path.join(proj, SKILL_DIR)), `${SKILL_DIR} exists`),
  );
  check(`before: no ${ORCH_DIR}/`, () =>
    expect(!existsSync(path.join(proj, ORCH_DIR)), `${ORCH_DIR} exists`),
  );
  check(
    "before: ci-github-actions emitted ci.yml (doctor's ci-workflow check needs it)",
    () =>
      expect(
        existsSync(path.join(proj, ".github/workflows/ci.yml")),
        "ci.yml missing",
      ),
  );

  // ---------------------------------------------------------------------------
  // 2. Install @hexagen-monaco/orchestration from the packed tarball with
  //    `yarn add`. sync and arch-linter are the generator's own pinned
  //    devDependencies; resolutions swap in the packed tarballs so no registry
  //    release is needed (same hermetic mechanism as the capstone).
  // ---------------------------------------------------------------------------
  step("yarn add the packed orchestration tarball");
  const pkgPath = path.join(proj, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.resolutions = {
    "@hexagen-monaco/sync": `file:${tarball.sync}`,
    "@hexagen-monaco/arch-linter": `file:${tarball["arch-linter"]}`,
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  check(
    "yarn add -D @hexagen-monaco/orchestration@file:<packed tarball>",
    () => {
      const pm =
        typeof pkg.packageManager === "string"
          ? pkg.packageManager
          : "yarn@4.12.0";
      sh("corepack", ["prepare", pm, "--activate"], proj, envHarness);
      sh(
        "yarn",
        ["add", "-D", `@hexagen-monaco/${ORCH}@file:${tarball[ORCH]}`],
        proj,
        envHarness,
      );
    },
  );
  const bin = (name: string): string =>
    path.join(proj, "node_modules/.bin", name);
  check(
    "installed package exposes hexagen-orchestration-{init,doctor,gate} and hexagen",
    () => {
      for (const b of [
        "hexagen-orchestration-init",
        "hexagen-orchestration-doctor",
        "hexagen-orchestration-gate",
        "hexagen",
      ]) {
        expect(existsSync(bin(b)), `${b} missing from node_modules/.bin`);
      }
    },
  );

  // A git repository, because doctor's `git worktree` capability check needs one.
  sh("git", ["init", "-q"], proj);

  // ---------------------------------------------------------------------------
  // 3. Install the template through AddTemplateUseCase, in-process, with the
  //    filesystem emitter and the disk config store (A-16). The answers go in as
  //    overrideAnswers (F-3: there is no --answers flag). The question engine
  //    throws if it is ever asked: every question is answered.
  // ---------------------------------------------------------------------------
  step("Install the orchestration template via AddTemplateUseCase");
  const refusingEngine: QuestionEnginePort = {
    ask: async (q) => {
      throw new Error(`unexpected interactive question '${q.id}'`);
    },
  };
  const registry = new FileSystemTemplateRegistry(TEMPLATES_DIR);
  const emitter = new FileSystemFileEmitter(TEMPLATES_DIR);
  const store = new FileSystemTemplateConfigStore();
  const addUseCase = new AddTemplateUseCase(
    registry,
    refusingEngine,
    emitter,
    store,
    true,
  );
  const overrideAnswers = { [ORCH]: { agents_md: true, node_version: "22" } };

  let firstInstall:
    | Awaited<ReturnType<AddTemplateUseCase["execute"]>>
    | undefined;
  try {
    firstInstall = await addUseCase.execute({
      templateIds: [ORCH],
      projectRoot: proj,
      overrideAnswers,
    });
  } catch (e) {
    check("AddTemplateUseCase.execute (first install)", () => {
      throw e;
    });
  }
  if (firstInstall) {
    const r = firstInstall;
    check("install: orchestration applied, none skipped, no warnings", () => {
      expect(
        JSON.stringify(r.applied) === JSON.stringify([ORCH]) &&
          r.skipped.length === 0 &&
          r.warnings.length === 0,
        JSON.stringify(r),
      );
    });
  }
  const outputs = [
    ".github/workflows/gate.yml",
    `${SKILL_DIR}/SKILL.md`,
    `${SKILL_DIR}/references/rationale.md`,
    `${SKILL_DIR}/references/briefs.md`,
    `${SKILL_DIR}/scripts/wave-event.sh`,
  ];
  check("install: all 5 template outputs are on disk", () => {
    const missing = outputs.filter((o) => !existsSync(path.join(proj, o)));
    expect(missing.length === 0, `missing: ${missing.join(", ")}`);
  });
  check("install: gate.yml has no uninterpolated {node_version}", () =>
    expect(
      !/\{node_version\}/.test(
        readFileSync(path.join(proj, ".github/workflows/gate.yml"), "utf8"),
      ),
      "gate.yml still has {node_version}",
    ),
  );
  check("install: wave-event.sh kept its executable bit", () =>
    expect(
      (statSync(path.join(proj, SKILL_DIR, "scripts/wave-event.sh")).mode &
        0o111) !==
        0,
      "not executable",
    ),
  );
  check(`after: ${CONFIG_FILE} is on disk and records the install`, () => {
    const file = path.join(proj, CONFIG_FILE);
    expect(existsSync(file), `${CONFIG_FILE} absent after the install`);
    const cfg = JSON.parse(readFileSync(file, "utf8")) as TemplateConfig;
    const rec = cfg.templates[ORCH];
    expect(rec !== undefined, "no orchestration record in templates");
    expect(
      rec.answers.node_version === "22" && rec.answers.agents_md === true,
      `answers: ${JSON.stringify(rec.answers)}`,
    );
    const recorded = rec.generatedFiles.map((f) => f.path).sort();
    expect(
      JSON.stringify(recorded) === JSON.stringify([...outputs].sort()),
      `generatedFiles: ${JSON.stringify(recorded)}`,
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Seed the overlay (OW1's campaign-foundry overlay), run init, then doctor.
  // ---------------------------------------------------------------------------
  step("Seed the overlay, run init, run doctor");
  mkdirSync(path.join(proj, ORCH_DIR), { recursive: true });
  cpSync(path.join(CF, "overlay"), path.join(proj, ORCH_DIR), {
    recursive: true,
  });
  const seededHashes = hashList(proj, ORCH_DIR);
  const initRun = run(bin("hexagen-orchestration-init"), [], { cwd: proj });
  check("init exits 0", () =>
    expect(initRun.status === 0, `exit ${initRun.status}\n${initRun.out}`),
  );
  check(
    "init leaves every seeded overlay file byte-identical (writes none of them)",
    () => {
      const after = hashList(proj, ORCH_DIR);
      // init may ADD files it scaffolds that the overlay lacks; it may never change or remove a seeded one.
      const afterSet = new Set(after);
      const changed = seededHashes.filter((l) => !afterSet.has(l));
      expect(
        changed.length === 0,
        `init changed or removed seeded files: ${changed.join("; ")}\n${initRun.out}`,
      );
    },
  );

  // Doctor, determinism (A-30 §8, plan §12.4 line 740): the expected findings are
  // the two `[lane-host local-opencode]` FAILs and the one no-seat WARN, "on a CI
  // runner". A developer machine can have `opencode` on PATH and a server on
  // :4096, which would turn those FAILs off. So doctor runs under a PINNED PATH
  // holding only what doctor legitimately needs (node, git, gh, yarn) and neither
  // `opencode` nor `curl`. The host's `dispatch[0]` (opencode) is then not on PATH
  // and its `check` (curl ...) cannot run, exactly as on a CI runner, whatever the
  // developer machine has. The assertion is the same exact set everywhere.
  const whichOnPath = (cmd: string): string => {
    const r = run("/bin/sh", ["-c", 'command -v "$1"', "sh", cmd]);
    expect(
      r.status === 0,
      `${cmd} is not on the PATH of this machine, but doctor needs it`,
    );
    return r.out.trim();
  };
  const pinnedBin = mkdtempSync(path.join(tmpdir(), "orch-rt-path-"));
  cleanup.push(() => rmSync(pinnedBin, { recursive: true, force: true }));
  for (const cmd of ["node", "git", "gh", "yarn"]) {
    check(`${cmd} is on PATH (doctor needs it)`, () =>
      symlinkSync(whichOnPath(cmd), path.join(pinnedBin, cmd)),
    );
  }
  chmodSync(pinnedBin, 0o755);
  const pinnedEnv: NodeJS.ProcessEnv = { ...process.env, PATH: pinnedBin };
  const doctor = run(bin("hexagen-orchestration-doctor"), [], {
    cwd: proj,
    env: pinnedEnv,
  });
  console.log("\n--- doctor output (pinned PATH: node, git, gh, yarn) ---");
  console.log(doctor.out.trimEnd());
  console.log("--- end doctor output ---\n");
  const fails = doctor.out.split("\n").filter((l) => l.startsWith("FAIL  "));
  const warns = doctor.out.split("\n").filter((l) => l.startsWith("WARN  "));
  check(
    "doctor: exactly 2 FAIL findings, both [lane-host local-opencode]",
    () => {
      expect(
        fails.length === 2 &&
          fails.every((l) => l.startsWith("FAIL  [lane-host local-opencode] ")),
        `FAILs:\n${fails.join("\n")}`,
      );
    },
  );
  check("doctor: FAIL 1 is dispatch[0] (opencode) not on PATH", () =>
    expect(
      fails.some((l) => l.includes("dispatch[0] (opencode) is not on PATH")),
      fails.join("\n"),
    ),
  );
  check("doctor: FAIL 2 is the host's check failing", () =>
    expect(
      fails.some((l) =>
        l.includes('check ["curl","-sf","http://127.0.0.1:4096/doc"]'),
      ),
      fails.join("\n"),
    ),
  );
  check(
    "doctor: exactly 1 WARN, [lane-host local-opencode], no seat references the host",
    () => {
      expect(
        warns.length === 1 &&
          warns[0].startsWith(
            "WARN  [lane-host local-opencode] no seat dispatches through this host",
          ),
        `WARNs:\n${warns.join("\n")}`,
      );
    },
  );
  check("doctor: nothing else FAILs or WARNs, exit 1", () => {
    expect(doctor.status === 1, `exit ${doctor.status}`);
    expect(
      doctor.out.includes("doctor: 2 problem(s) to fix."),
      "summary line is not '2 problem(s)'",
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Check (b) green, then the stable hash, then the forced reinstall.
  // ---------------------------------------------------------------------------
  step("Check (b): gate --print-steps equals OW1's expected-steps.tsv (A-17)");
  const expectedSteps = readFileSync(
    path.join(CF, "expected-steps.tsv"),
    "utf8",
  );
  const stepsRun = run(bin("hexagen-orchestration-gate"), ["--print-steps"], {
    cwd: proj,
  });
  check("(b) green: gate --print-steps exits 0", () =>
    expect(stepsRun.status === 0, `exit ${stepsRun.status}\n${stepsRun.out}`),
  );
  check(
    "(b) green: --print-steps equals expected-steps.tsv, line for line (11 lines)",
    () => {
      const diff = firstLineDiff(stepsRun.stdout, expectedSteps);
      expect(diff === undefined, `first difference at ${diff}`);
      expect(
        expectedSteps.trimEnd().split("\n").length === 11,
        "expected-steps.tsv is not 11 lines",
      );
    },
  );

  step(
    "Check (c) baseline, then the forced reinstall through the same use case",
  );
  const before = hashList(proj, ORCH_DIR);
  check(`(c) baseline: ${ORCH_DIR}/ has files to compare`, () =>
    expect(before.length >= 6, `only ${before.length} files`),
  );
  const notForced = await addUseCase.execute({
    templateIds: [ORCH],
    projectRoot: proj,
    overrideAnswers,
  });
  check("reinstall without force: skipped, nothing applied", () =>
    expect(
      notForced.skipped.includes(ORCH) && notForced.applied.length === 0,
      JSON.stringify(notForced),
    ),
  );
  const forced = await addUseCase.execute({
    templateIds: [ORCH],
    projectRoot: proj,
    overrideAnswers,
    skipInstalled: false,
  });
  check("reinstall with force: orchestration re-applied with no warnings", () =>
    expect(
      JSON.stringify(forced.applied) === JSON.stringify([ORCH]) &&
        forced.warnings.length === 0,
      JSON.stringify(forced),
    ),
  );
  check("reinstall with force: wrote no conflict copies", () => {
    const found: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        if (name === "node_modules" || name === ".git") continue;
        const full = path.join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.conflict(\.|$)/.test(name))
          found.push(path.relative(proj, full));
      }
    };
    walk(proj);
    expect(found.length === 0, `conflict copies: ${found.join(", ")}`);
  });
  const after = hashList(proj, ORCH_DIR);
  check(
    `(c) green: sha256 list of ${ORCH_DIR}/ identical before and after the forced reinstall`,
    () => {
      const diff = firstHashDiff(before, after);
      expect(diff === undefined, `first difference at ${diff}`);
    },
  );

  // ---------------------------------------------------------------------------
  // 6. Check (a): coverage over the INSTALLED tree.
  // ---------------------------------------------------------------------------
  step(
    "Check (a): skill-coverage over the installed skill + the seeded overlay",
  );
  const installedSkill = path.join(proj, SKILL_DIR);
  const installedOverlay = path.join(proj, ORCH_DIR);
  const coverage = (): Ran => {
    return run(process.execPath, [
      path.join(REPO, "scripts/orchestration/skill-coverage.mjs"),
      "--source",
      path.join(FIXTURE, "source"),
      "--tree",
      installedSkill,
      "--tree",
      installedOverlay,
      "--allowlist",
      path.join(installedOverlay, "coverage-allowlist.txt"),
      "--sites",
      path.join(CF, "specific-sites.txt"),
      "--generic",
      installedSkill,
      "--token-review",
      path.join(CF, "generic-token-review.txt"),
      "--hexagen-root",
      REPO,
    ]);
  };
  const covGreen = coverage();
  check("(a) green: coverage exits 0 over the installed tree", () =>
    expect(
      covGreen.status === 0,
      `exit ${covGreen.status}\n${tail(covGreen.out)}`,
    ),
  );
  check("(a) green: every unit traced, counts asserted", () => {
    for (const s of [
      "SKILL.md: 71 anchors [heading, boldLead], 86 paragraphs, both asserted",
      "rationale.md: 45 anchors [heading], 98 paragraphs, both asserted",
      "cast.md: 35 anchors [heading], 145 paragraphs, both asserted",
      "totals: 151 anchors, 329 paragraphs, over 2 tree(s)",
      "clean: every anchor and every paragraph of the snapshot survives",
    ]) {
      expect(covGreen.out.includes(s), `missing: ${s}\n${tail(covGreen.out)}`);
    }
  });

  // Red (a): delete, from the installed tree, one unit that is in source/, absent
  // from the overlay, and not allowlisted: a heading of the installed SKILL.md
  // that source/SKILL.md has as a line, that no overlay file has, and that occurs
  // exactly once across the two trees (so its deletion cannot be covered elsewhere).
  const skillMd = path.join(installedSkill, "SKILL.md");
  const skillOriginal = readFileSync(skillMd, "utf8");
  {
    const sourceLines = new Set(
      linesOf(path.join(FIXTURE, "source/SKILL.md")).map((l) => l.trim()),
    );
    const overlayLines = new Set<string>();
    for (const f of readdirSync(installedOverlay)) {
      const full = path.join(installedOverlay, f);
      if (statSync(full).isFile())
        for (const l of linesOf(full)) overlayLines.add(l.trim());
    }
    const skillFileLines = skillOriginal.split("\n");
    const treeLineCount = new Map<string, number>();
    for (const f of [
      "SKILL.md",
      "references/rationale.md",
      "references/briefs.md",
    ]) {
      for (const l of linesOf(path.join(installedSkill, f))) {
        treeLineCount.set(l.trim(), (treeLineCount.get(l.trim()) ?? 0) + 1);
      }
    }
    const victimIndex = skillFileLines.findIndex(
      (l) =>
        /^#{1,6} \S/.test(l) &&
        sourceLines.has(l.trim()) &&
        !overlayLines.has(l.trim()) &&
        treeLineCount.get(l.trim()) === 1,
    );
    check(
      "(a) red: a deletable unit exists (in source/, not in the overlay, unique in the tree)",
      () =>
        expect(victimIndex >= 0, "no such heading in the installed SKILL.md"),
    );
    if (victimIndex >= 0) {
      const victim = skillFileLines[victimIndex];
      writeFileSync(
        skillMd,
        skillFileLines.filter((_, i) => i !== victimIndex).join("\n"),
      );
      let red: Ran;
      try {
        red = coverage();
      } finally {
        writeFileSync(skillMd, skillOriginal);
      }
      console.log(
        `\n--- (a) red output (deleted: ${JSON.stringify(victim)}) ---`,
      );
      console.log(tail(red.out, 12));
      console.log("--- end (a) red output ---\n");
      check("(a) red: coverage exits 1 after the unit is deleted", () =>
        expect(red.status === 1, `exit ${red.status}\n${tail(red.out)}`),
      );
      check("(a) red: coverage names the deleted unit", () =>
        expect(
          red.out.includes(victim.trim()),
          `${JSON.stringify(victim)} not named\n${tail(red.out)}`,
        ),
      );
      const regreen = coverage();
      check("(a) red: restored, coverage is green again", () =>
        expect(
          regreen.status === 0,
          `exit ${regreen.status}\n${tail(regreen.out)}`,
        ),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Reds for (b) and (c).
  // ---------------------------------------------------------------------------
  step(
    "Check (b) red: one changed expected-steps.tsv line fails the comparison",
  );
  {
    const lines = expectedSteps.split("\n");
    const at = lines.findIndex((l) => l.startsWith("lint\t"));
    const mutated = lines
      .map((l, i) => (i === at ? "lint\tyarn lint --fix" : l))
      .join("\n");
    const diff = firstLineDiff(stepsRun.stdout, mutated);
    console.log(`  (b) red comparison result: ${diff ?? "NO DIFFERENCE"}`);
    check("(b) red: the comparison fails and names the changed line", () =>
      expect(
        diff !== undefined && diff.startsWith(`line ${at + 1}:`),
        `diff was ${diff}`,
      ),
    );
  }

  step(
    "Check (c) red (synthetic, F-14): the comparator catches a changed overlay file",
  );
  {
    // No real mechanism rewrites the overlay (that is the claim), so this red cannot
    // arise naturally. It proves the COMPARATOR, not the mechanism, and says so.
    const cfgFile = path.join(installedOverlay, "lessons.md");
    const original = readFileSync(cfgFile);
    writeFileSync(cfgFile, Buffer.concat([original, Buffer.from("\n")]));
    const changed = firstHashDiff(before, hashList(proj, ORCH_DIR));
    writeFileSync(cfgFile, original);
    check("(c) red: one appended byte in an overlay file is reported", () =>
      expect(
        changed !== undefined && changed.includes("vs"),
        `diff was ${changed}`,
      ),
    );
    console.log(`  (c) red comparison result: ${changed}`);
    const restored = firstHashDiff(before, hashList(proj, ORCH_DIR));
    check("(c) red: restored, the lists are identical again", () =>
      expect(restored === undefined, `diff was ${restored}`),
    );
  }

  // ---------------------------------------------------------------------------
  // 8. validate-templates against the project, using the PACKED sync's own bin.
  // ---------------------------------------------------------------------------
  step("hexagen validate-templates against the project");
  const validate = run(bin("hexagen"), ["validate-templates"], { cwd: proj });
  console.log("\n--- validate-templates output ---");
  console.log(validate.out.trimEnd());
  console.log("--- end validate-templates output ---\n");
  check("validate-templates exits 0", () =>
    expect(validate.status === 0, `exit ${validate.status}`),
  );
  check("validate-templates reports the orchestration install", () =>
    expect(
      /Installed templates: orchestration\b/.test(validate.out) &&
        validate.out.includes("✅ orchestration"),
      validate.out,
    ),
  );
  check("validate-templates: zero missing files", () =>
    expect(!validate.out.includes("Missing:"), validate.out),
  );
  check("validate-templates: zero unresolved conflicts", () =>
    expect(!validate.out.includes("Unresolved conflict"), validate.out),
  );
  check("validate-templates: all output files present, no conflicts", () =>
    expect(
      validate.out.includes("All output files present, no conflicts") &&
        validate.out.includes("All templates pass validation."),
      validate.out,
    ),
  );

  // ---------------------------------------------------------------------------
} catch (e) {
  failures++;
  console.log("\nround-trip: FAIL  uncaught error aborted the run");
  console.log(
    String((e as Error)?.stack ?? e)
      .split("\n")
      .map((l) => `        ${l}`)
      .join("\n"),
  );
} finally {
  for (const fn of cleanup.reverse()) {
    try {
      fn();
    } catch {
      // best effort
    }
  }
}
console.log(
  failures === 0
    ? "\nround-trip: ALL ASSERTIONS PASSED"
    : `\nround-trip: ${failures} ASSERTION(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
