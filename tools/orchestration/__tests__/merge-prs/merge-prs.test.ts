import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The pre-PR-review merge gate, and the wiring around it.
 *
 * Ported from the source suite. The script is zsh, and GitHub's Linux runners
 * do not ship zsh, so every test that RUNS it is guarded by `hasZsh` and says
 * why it is skipped. The gate's own decision logic is covered in
 * `__tests__/internal/{pre-pr,risk,rows}.test.ts` and the merge condition's in
 * `__tests__/sweep/gate.test.ts`; what belongs here is the wiring — the
 * 5-field spec parse, and that a refusal happens BEFORE the script touches git
 * or the forge at all.
 *
 * `npx` is stubbed on PATH so `pre-pr-check` never really runs — its own
 * behaviour is somebody else's test — and so no test here needs a real origin
 * remote, `gh`, or a network call. The stub answers two commands and no more:
 * `hexagen-orchestration-plan-review` with the exit the test chooses, and
 * `hexagen-orchestration-sweep config requiredCheck` with the project's
 * required-check pattern. Every one of these tests stops at the pre-PR gate or
 * at `git fetch`, so `append-only`, `keep-both`, `checks` and `gate` are never
 * reached from here — they are the sweep suite's tests.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(PACKAGE_ROOT, "bin/merge-prs");

/**
 * The inherited environment WITHOUT any `GIT_*` variable. A test run inside a
 * git hook (or any tool that exports `GIT_DIR`, `GIT_INDEX_FILE`, …) would
 * otherwise point every git call here — the script's and the fixtures' — at the
 * caller's repository instead of the throwaway one.
 */
const cleanEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );

function hasZsh(): boolean {
  return spawnSync("zsh", ["-c", "exit 0"]).status === 0;
}

const NO_ZSH =
  "zsh is not installed. The merge script is zsh by design (the source repo's CI has no zsh either), so its wiring is only observable with a zsh present.";

interface Harness {
  readonly repoDir: string;
  /** argv of every `npx --no-install hexagen-orchestration-plan-review` call. */
  readonly markerFile: string;
  /** argv of every `hexagen-orchestration-sweep config requiredCheck` call. */
  readonly configMarkerFile: string;
  readonly stubBinDir: string;
  cleanup(): void;
}

/**
 * A throwaway git repo (REPO, via `git rev-parse --show-toplevel`) plus a
 * stubbed `npx` on PATH.
 *
 * Two markers, because two different things are being asserted: the pre-PR
 * gate's arguments, and the required-check lookup's. The stub records the
 * former ONLY for the plan-review call, so a marker that is empty means the
 * gate was never consulted rather than that the stub was silent.
 */
function makeHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "merge-prs-test-"));
  const repoDir = join(root, "repo");
  mkdirSync(repoDir, { recursive: true });
  const gitEnv = cleanEnv();
  const init = spawnSync("git", ["init", "-q"], { cwd: repoDir, env: gitEnv });
  if (init.status !== 0)
    throw new Error(`git init failed: ${init.stderr?.toString()}`);
  spawnSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: repoDir,
    env: gitEnv,
  });
  spawnSync("git", ["config", "user.name", "Test"], {
    cwd: repoDir,
    env: gitEnv,
  });

  const stubBinDir = join(root, "bin");
  mkdirSync(stubBinDir, { recursive: true });
  const markerFile = join(root, "marker.log");
  const configMarkerFile = join(root, "config-marker.log");
  const stub = [
    "#!/bin/sh",
    'joined=" $* "',
    'case "$joined" in',
    '  *" hexagen-orchestration-plan-review "*)',
    '    echo "$*" >> "$MARKER_FILE"',
    '    exit "${STUB_PREPR_EXIT:-0}"',
    "    ;;",
    "esac",
    'case "$joined" in',
    '  *" config repo "*)',
    '    printf "%s" "${STUB_REPO-acme/demo}"',
    '    exit "${STUB_REPO_EXIT:-0}"',
    "    ;;",
    "esac",
    'case "$joined" in',
    '  *" config requiredCheck "*)',
    '    echo "$*" >> "$CONFIG_MARKER_FILE"',
    '    printf "%s" "${STUB_CONFIG_OUT-^Build}"',
    '    exit "${STUB_CONFIG_EXIT:-0}"',
    "    ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n");
  const stubPath = join(stubBinDir, "npx");
  writeFileSync(stubPath, stub);
  chmodSync(stubPath, 0o755);

  return {
    repoDir,
    markerFile,
    configMarkerFile,
    stubBinDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * The environment a run gets, with the stub directory prepended to `PATH`.
 *
 * `PATH` is read through a local alias rather than `process.env.PATH` because
 * no task declares it and the rule that enforces that fires on the member
 * access — the same reason the bins hand `process.env` around whole.
 */
const runEnv = (harness: Harness, extra: Readonly<Record<string, string>>) => {
  const inherited = cleanEnv();
  return {
    ...inherited,
    PATH: `${harness.stubBinDir}:${inherited.PATH ?? ""}`,
    MARKER_FILE: harness.markerFile,
    CONFIG_MARKER_FILE: harness.configMarkerFile,
    ...extra,
  };
};

function runMergePrs(
  harness: Harness,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
) {
  return spawnSync("zsh", [SCRIPT, ...args], {
    cwd: harness.repoDir,
    encoding: "utf8",
    env: runEnv(harness, env),
  });
}

function marker(harness: Harness): string {
  return existsSync(harness.markerFile)
    ? readFileSync(harness.markerFile, "utf8")
    : "";
}

function configMarker(harness: Harness): string {
  return existsSync(harness.configMarkerFile)
    ? readFileSync(harness.configMarkerFile, "utf8")
    : "";
}

describe.skipIf(!hasZsh())("merge-prs — the pre-PR-review merge gate", () => {
  test("a refused lane dies before the script prints anything about the PR at all", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(
        harness,
        ["42|wt|feat/x|RX-2-reserved-slots|wv-2"],
        {
          STUB_PREPR_EXIT: "1",
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("pre-PR-review gate refused the merge");
      expect(result.stdout).not.toContain("=== PR #42");
      expect(marker(harness)).toContain(
        "pre-pr-check RX-2-reserved-slots --wave wv-2",
      );
    } finally {
      harness.cleanup();
    }
  });

  test("an empty lane field keeps today's behaviour: the gate is never consulted", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, ["42||fix/typo"]);
      // The script proceeds past the (skipped) gate and prints the PR banner —
      // whatever it fails on next (no origin remote here) is not the gate's doing.
      expect(result.stdout).toContain("=== PR #42");
      expect(result.stderr).not.toContain("pre-PR-review gate");
      expect(marker(harness)).toBe("");
    } finally {
      harness.cleanup();
    }
  });

  test("a genuinely 3-field spec (no lane/wave fields at all, not just empty ones) keeps today's behaviour", () => {
    // "42||fix/typo" already proves an EMPTY lane field is skipped. This
    // proves the shorter, pre-gate spec shape itself — a caller that never
    // learned about the two newer fields — parses the same way.
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, ["42|wt|feat/x"]);
      expect(result.stdout).toContain("=== PR #42");
      expect(result.stderr).not.toContain("pre-PR-review gate");
      expect(marker(harness)).toBe("");
    } finally {
      harness.cleanup();
    }
  });

  test("a gate exit other than 0/1 (usage error or a broken run) is distinguished from a refusal", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(
        harness,
        ["42|wt|feat/x|RX-2-reserved-slots|wv-2"],
        {
          STUB_PREPR_EXIT: "2",
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("could not run (exit 2)");
      expect(result.stderr).not.toContain("refused the merge");
      expect(result.stdout).not.toContain("=== PR #42");
    } finally {
      harness.cleanup();
    }
  });

  test("a lane with no wave dies immediately, naming both, without calling the gate", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, [
        "42|wt|feat/x|RX-2-reserved-slots|",
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("RX-2-reserved-slots");
      expect(result.stderr).toContain("no wave");
      expect(result.stdout).not.toContain("=== PR #42");
      expect(marker(harness)).toBe("");
    } finally {
      harness.cleanup();
    }
  });

  test("a passing gate lets the script proceed to the PR's own work", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(
        harness,
        ["42|wt|feat/x|RX-1-pre-pr-gate|wv-2"],
        {
          STUB_PREPR_EXIT: "0",
        },
      );
      expect(result.stdout).toContain("=== PR #42");
      expect(result.stderr).not.toContain("pre-PR-review gate refused");
      expect(marker(harness)).toContain(
        "pre-pr-check RX-1-pre-pr-gate --wave wv-2",
      );
    } finally {
      harness.cleanup();
    }
  });

  test("--logdir is forwarded to pre-pr-check only when the script itself was given one", () => {
    const harness = makeHarness();
    try {
      runMergePrs(
        harness,
        ["--logdir", "/tmp/some-wave-log", "42|wt|feat/x|RX-1|wv-2"],
        {
          STUB_PREPR_EXIT: "0",
        },
      );
      expect(marker(harness)).toContain("--logdir /tmp/some-wave-log");
    } finally {
      harness.cleanup();
    }
  });

  test("without --logdir, pre-pr-check is left to resolve its own default", () => {
    const harness = makeHarness();
    try {
      runMergePrs(harness, ["42|wt|feat/x|RX-1|wv-2"], {
        STUB_PREPR_EXIT: "0",
      });
      const line = marker(harness);
      expect(line).toContain("pre-pr-check RX-1 --wave wv-2");
      expect(line).not.toContain("--logdir");
    } finally {
      harness.cleanup();
    }
  });

  test("a bare --logdir with no directory value dies with a usage message", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, ["--logdir"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--logdir requires a directory");
    } finally {
      harness.cleanup();
    }
  });
});

/**
 * The required-check pattern, resolved once from the project's overlay.
 *
 * An empty pattern matches every check name, so a lookup that answers nothing
 * is a gate that passes a PR whose build never ran. Both failures die here,
 * before the loop.
 */
describe.skipIf(!hasZsh())("merge-prs — the required-check pattern", () => {
  test("with no REQUIRED_CHECK exported, the overlay is asked exactly once", () => {
    const harness = makeHarness();
    try {
      runMergePrs(harness, ["42|wt|feat/x"]);
      const asked = configMarker(harness);
      expect(asked).toContain("config requiredCheck");
      expect(asked.trim().split("\n")).toHaveLength(1);
    } finally {
      harness.cleanup();
    }
  });

  test("the lookup happens BEFORE the loop, so a spec that dies never asks twice", () => {
    const harness = makeHarness();
    try {
      // A lane with no wave dies at the top of the first iteration.
      runMergePrs(harness, ["42|wt|feat/x|RX-1|"]);
      // It must have HAPPENED (an empty marker would also "not ask twice"),
      // exactly once, and for the required check.
      const asked = configMarker(harness);
      expect(asked).not.toBe("");
      expect(asked).toContain("requiredCheck");
      expect(asked.trim().split("\n")).toHaveLength(1);
    } finally {
      harness.cleanup();
    }
  });

  test("an exported REQUIRED_CHECK is taken at its word and the overlay is never asked", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, ["42|wt|feat/x"], {
        REQUIRED_CHECK: "^Deploy",
      });
      expect(result.stdout).toContain("=== PR #42");
      expect(configMarker(harness)).toBe("");
    } finally {
      harness.cleanup();
    }
  });

  test("a lookup that fails dies, before any PR is touched", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, ["42|wt|feat/x"], {
        STUB_CONFIG_EXIT: "1",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("could not resolve REQUIRED_CHECK");
      expect(result.stdout).not.toContain("=== PR #42");
    } finally {
      harness.cleanup();
    }
  });

  test("a lookup that answers nothing dies — an empty pattern would match every check", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, ["42|wt|feat/x"], {
        STUB_CONFIG_OUT: "",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("refusing to gate on an empty pattern");
      expect(result.stdout).not.toContain("=== PR #42");
    } finally {
      harness.cleanup();
    }
  });
});

describe.skipIf(!hasZsh())("merge-prs — the repository", () => {
  test("a GH_REPO that disagrees with the overlay dies, naming both, before any PR", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, ["42|wt|feat/x"], {
        GH_REPO: "globex/rollup",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("globex/rollup");
      expect(result.stderr).toContain("acme/demo");
      expect(result.stdout).not.toContain("=== PR #42");
    } finally {
      harness.cleanup();
    }
  });

  test("a GH_REPO that agrees is accepted", () => {
    const harness = makeHarness();
    try {
      const result = runMergePrs(harness, ["42|wt|feat/x"], {
        GH_REPO: "acme/demo",
      });
      expect(result.stdout).toContain("=== PR #42");
    } finally {
      harness.cleanup();
    }
  });

  test("a lookup that fails, or answers nothing, dies before any PR", () => {
    for (const env of [
      { STUB_REPO_EXIT: "1" },
      { STUB_REPO: "" },
    ] as readonly Record<string, string>[]) {
      const harness = makeHarness();
      try {
        const result = runMergePrs(harness, ["42|wt|feat/x"], env);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("repository");
        expect(result.stdout).not.toContain("=== PR #42");
      } finally {
        harness.cleanup();
      }
    }
  });
});

/**
 * The script's own text.
 *
 * These run everywhere — no zsh, no repository, no forge — because the defect
 * they look for is a string that ships. The patterns are assembled from
 * fragments so that this file does not itself carry any of them.
 */
describe("merge-prs — what the script may not contain", () => {
  const text = readFileSync(SCRIPT, "utf8");

  const FORBIDDEN: readonly { needle: string; why: string }[] = [
    {
      needle: ["pyt", "hon3"].join(""),
      why: "an interpreter this package dropped as a capability; the pattern and the parse live in TypeScript",
    },
    {
      needle: ["yar", "n "].join(""),
      why: "a root script alias; the bins are called with npx --no-install",
    },
    {
      needle: ["app", "s/"].join(""),
      why: "one repository's directory layout",
    },
    { needle: ["nit", "ro"].join(""), why: "one repository's framework" },
    {
      needle: ["APPEND_ONLY", "="].join(""),
      why: "a shell default for the append-only pattern, which would shadow the project's own",
    },
    {
      needle: ["D18", "4"].join(""),
      why: "one repository's decision id; the rule is stated as prose instead",
    },
  ];

  test.each(FORBIDDEN)("the script carries no $why", ({ needle }) => {
    expect(text.includes(needle)).toBe(false);
  });

  test("the script names no PR number in a comment", () => {
    const cited = text.split("\n").filter((line) => /^#.*#\d+/.test(line));
    expect(cited).toEqual([]);
  });

  test("every call into the package is `npx --no-install hexagen-orchestration-…`", () => {
    const calls = text
      .split("\n")
      .filter(
        (line) =>
          line.includes("hexagen-orchestration-") &&
          !line.trimStart().startsWith("#"),
      );
    expect(calls.length).toBeGreaterThan(4);
    for (const line of calls) {
      expect(line, line.trim()).toContain(
        "npx --no-install hexagen-orchestration-",
      );
    }
  });

  test("the script asks the package for the four commands it used to carry itself", () => {
    for (const command of [
      "append-only",
      "keep-both",
      "checks",
      "config requiredCheck",
    ]) {
      expect(text, command).toContain(`hexagen-orchestration-sweep ${command}`);
    }
    expect(text).toContain("hexagen-orchestration-plan-review");
    expect(text).toContain("hexagen-orchestration-sweep gate");
  });

  test("the script keeps the source's structure: both polls, the head check, the settle wait and the squash", () => {
    for (const fragment of [
      "set -u -o pipefail",
      "MAIN=${MAIN_BRANCH:-main}",
      "git merge-base --is-ancestor",
      "check-runs",
      "REVIEW_SETTLE_SECONDS=${REVIEW_SETTLE_SECONDS:-120}",
      'gh pr merge "$pr" --squash',
      "git worktree prune",
      "ALL DONE",
    ]) {
      expect(text, fragment).toContain(fragment);
    }
  });
});

describe.skipIf(!hasZsh())(`merge-prs — the script parses (${NO_ZSH})`, () => {
  test("zsh -n reports no syntax error", () => {
    const result = spawnSync("zsh", ["-n", SCRIPT], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

/**
 * The refresh and the check read, end to end against the real built `sweep`.
 *
 * `npx --no-install` resolves a package's bins only from inside the project
 * that has them installed. The refresh for a PR with no worktree runs in a
 * throwaway worktree under the temp directory, which has no `node_modules`, so a
 * call made from there finds nothing. The stub here emulates that resolution —
 * it answers 127, as npx does, unless the working directory is inside the
 * repository — and otherwise hands the call to the real built bin, so the
 * append-only test, the resolver and the check parse are the shipped ones.
 */
describe.skipIf(!hasZsh())(
  "merge-prs — the refresh and the check read, against the real sweep bin",
  () => {
    const SWEEP_BIN = resolve(PACKAGE_ROOT, "dist/bins/sweep.js");

    interface Scenario {
      readonly repoDir: string;
      readonly stubBinDir: string;
      readonly root: string;
      cleanup(): void;
    }

    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        env: cleanEnv(),
      });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };

    /**
     * A clone of a bare origin. `feat/x` and `main` each appended a line to
     * CHANGELOG.md when `conflict` is set, so refreshing `feat/x` conflicts in
     * a file the overlay declares append-only.
     */
    function makeScenario(conflict: boolean): Scenario {
      const root = realpathSync(
        mkdtempSync(join(tmpdir(), "merge-prs-refresh-")),
      );
      const origin = join(root, "origin.git");
      const repoDir = join(root, "repo");
      git(root, "init", "-q", "--bare", "-b", "main", origin);
      git(root, "clone", "-q", origin, repoDir);
      git(repoDir, "config", "user.email", "test@example.invalid");
      git(repoDir, "config", "user.name", "Test");
      git(repoDir, "checkout", "-q", "-b", "main");
      writeFileSync(join(repoDir, "CHANGELOG.md"), "# Log\n");
      git(repoDir, "add", "CHANGELOG.md");
      git(repoDir, "commit", "-q", "-m", "base");
      git(repoDir, "push", "-q", "origin", "main");
      git(repoDir, "checkout", "-q", "-b", "feat/x");
      writeFileSync(join(repoDir, "feature.txt"), "feature\n");
      git(repoDir, "add", "feature.txt");
      if (conflict)
        writeFileSync(join(repoDir, "CHANGELOG.md"), "# Log\n- feature\n");
      git(repoDir, "add", "CHANGELOG.md");
      git(repoDir, "commit", "-q", "-m", "feature");
      git(repoDir, "push", "-q", "origin", "feat/x");
      git(repoDir, "checkout", "-q", "main");
      writeFileSync(
        join(repoDir, "CHANGELOG.md"),
        conflict ? "# Log\n- main change\n" : "# Log\n",
      );
      writeFileSync(join(repoDir, "other.txt"), "other\n");
      git(repoDir, "add", "CHANGELOG.md", "other.txt");
      git(repoDir, "commit", "-q", "-m", "main moves");
      git(repoDir, "push", "-q", "origin", "main");
      mkdirSync(join(repoDir, ".agents/orchestration"), { recursive: true });
      writeFileSync(
        join(repoDir, ".agents/orchestration/config.yaml"),
        "repo: acme/demo\nappendOnlyPaths: ^CHANGELOG\\.md$\n",
      );

      const stubBinDir = join(root, "bin");
      mkdirSync(stubBinDir, { recursive: true });
      const npx = [
        "#!/bin/sh",
        'case "$PWD" in',
        '  "$REPO_DIR"|"$REPO_DIR"/*) ;;',
        '  *) echo "npx: command not found in project" >&2; exit 127 ;;',
        "esac",
        'case " $* " in',
        '  *" hexagen-orchestration-sweep gate "*) exit 0 ;;',
        '  *" hexagen-orchestration-sweep "*) shift 2; exec node "$SWEEP_BIN" "$@" ;;',
        "esac",
        "exit 0",
        "",
      ].join("\n");
      // The forge: one failing run on the pushed head, named with spaces.
      const gh = [
        "#!/bin/sh",
        'echo "GH_REPO=$GH_REPO $*" >> "$GH_LOG"',
        'case " $* " in',
        // The forge: one healthy run, then two failing ones — one named with
        // spaces, one with parentheses — as a later "page" would deliver them.
        "  *check-runs*)",
        '    echo \'{"n":"Lint","s":"completed","c":"success"}\'',
        '    [ -n "${GH_GREEN:-}" ] && { echo \'{"n":"Build","s":"completed","c":"success"}\'; exit 0; }',
        '    echo \'{"n":"Build and Test","s":"completed","c":"failure"}\'',
        '    echo \'{"n":"Build (linux)","s":"completed","c":"failure"}\' ;;',
        "esac",
        "exit 0",
        "",
      ].join("\n");
      // A git that fails ONE named operation and passes everything else to the
      // real one, to observe what the script does when housekeeping fails.
      const gitStub = [
        "#!/bin/sh",
        'if [ -n "${STUB_GIT_FAIL:-}" ]; then',
        '  case " $* " in',
        '    *" $STUB_GIT_FAIL "*) echo "fatal: stubbed failure of $STUB_GIT_FAIL" >&2; exit 1 ;;',
        "  esac",
        "fi",
        'exec "$REAL_GIT" "$@"',
        "",
      ].join("\n");
      for (const [name, body] of [
        ["npx", npx],
        ["gh", gh],
        ["git", gitStub],
      ] as const) {
        writeFileSync(join(stubBinDir, name), body);
        chmodSync(join(stubBinDir, name), 0o755);
      }
      return {
        repoDir,
        stubBinDir,
        root,
        cleanup: () => rmSync(root, { recursive: true, force: true }),
      };
    }

    const runScenario = (
      s: Scenario,
      extra: Readonly<Record<string, string>> = {},
    ) => {
      const inherited = cleanEnv();
      return spawnSync("zsh", [SCRIPT, "42||feat/x"], {
        cwd: s.repoDir,
        encoding: "utf8",
        env: {
          ...inherited,
          PATH: `${s.stubBinDir}:${inherited.PATH ?? ""}`,
          REPO_DIR: s.repoDir,
          SWEEP_BIN,
          GH_LOG: join(s.root, "gh.log"),
          REAL_GIT: spawnSync("sh", ["-c", "command -v git"], {
            encoding: "utf8",
          }).stdout.trim(),
          REVIEW_SETTLE_SECONDS: "0",
          ...extra,
        },
      });
    };

    test("an append-only conflict in the temporary worktree resolves, and the run proceeds past the refresh", () => {
      const s = makeScenario(true);
      try {
        const result = runScenario(s);
        expect(result.stderr).not.toContain("command not found in project");
        expect(result.stdout).toContain(
          "resolved append-only conflicts: CHANGELOG.md",
        );
        expect(result.stdout).toContain("waiting for checks on");
        // Ours (the branch) then theirs (main), pushed to the branch ref.
        expect(
          git(s.repoDir, "show", "origin/feat/x:CHANGELOG.md").replace(
            /\r/g,
            "",
          ),
        ).toBe("# Log\n- feature\n- main change\n");
      } finally {
        s.cleanup();
      }
    });

    test("a failed check named with spaces is reported whole, not cut at the first space", () => {
      const s = makeScenario(false);
      try {
        const result = runScenario(s);
        expect(result.stdout).toContain(
          "CHECKS FAILED for #42: Build and Test,Build (linux)",
        );
        expect(result.status).toBe(1);
      } finally {
        s.cleanup();
      }
    });

    test("a REQUIRED_CHECK with regex escapes still registers: the pattern never enters a jq program", () => {
      const s = makeScenario(false);
      try {
        const result = runScenario(s, { REQUIRED_CHECK: "^Build \\(linux\\)" });
        expect(result.stdout).toContain("waiting for checks on");
        expect(result.stdout).not.toContain("NO CHECKS REGISTERED");
        expect(result.stdout).toContain("CHECKS FAILED for #42:");
      } finally {
        s.cleanup();
      }
    });

    test("both polls read every page of check runs", () => {
      const s = makeScenario(false);
      try {
        runScenario(s);
        const calls = readFileSync(join(s.root, "gh.log"), "utf8")
          .split("\n")
          .filter((line) => line.includes("check-runs"));
        expect(calls.length).toBeGreaterThanOrEqual(2);
        for (const call of calls) {
          expect(call).toContain("--paginate");
          expect(call).toContain("per_page=100");
        }
      } finally {
        s.cleanup();
      }
    });

    test("every gh call runs with GH_REPO set to the overlay's repository", () => {
      const s = makeScenario(false);
      try {
        runScenario(s);
        const calls = readFileSync(join(s.root, "gh.log"), "utf8")
          .split("\n")
          .filter((line) => line !== "");
        expect(calls.length).toBeGreaterThanOrEqual(2);
        for (const call of calls) expect(call).toMatch(/^GH_REPO=acme\/demo /);
      } finally {
        s.cleanup();
      }
    });

    describe("the housekeeping after the merge", () => {
      const green = { GH_GREEN: "1" };

      test("a clean run merges, cleans up and says ALL DONE with exit 0", () => {
        const s = makeScenario(false);
        try {
          const result = runScenario(s, green);
          expect(result.stdout).toContain("merged #42");
          expect(result.stdout).toContain("ALL DONE");
          expect(result.stderr).not.toContain("WARN:");
          expect(result.status).toBe(0);
        } finally {
          s.cleanup();
        }
      });

      test("a failed final pull dies after the merge, naming what did not sync", () => {
        const s = makeScenario(false);
        try {
          const result = runScenario(s, { ...green, STUB_GIT_FAIL: "pull" });
          expect(result.stdout).toContain("merged #42");
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("did not sync");
          expect(result.stdout).not.toContain("ALL DONE");
        } finally {
          s.cleanup();
        }
      });

      test("a failed branch delete is a WARN, and the run ends DONE WITH WARNINGS with exit 1", () => {
        const s = makeScenario(false);
        try {
          const result = runScenario(s, {
            ...green,
            STUB_GIT_FAIL: "--delete",
          });
          expect(result.stdout).toContain("merged #42");
          expect(result.stderr).toContain(
            "WARN: could not delete origin/feat/x",
          );
          expect(result.stdout).toContain("DONE WITH WARNINGS");
          expect(result.stdout).not.toContain("ALL DONE");
          expect(result.status).toBe(1);
        } finally {
          s.cleanup();
        }
      });
    });
  },
);
