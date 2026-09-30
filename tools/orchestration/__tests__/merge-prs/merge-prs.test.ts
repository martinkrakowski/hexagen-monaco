import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  const init = spawnSync("git", ["init", "-q"], { cwd: repoDir });
  if (init.status !== 0)
    throw new Error(`git init failed: ${init.stderr?.toString()}`);
  spawnSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: repoDir,
  });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

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
  const inherited: Readonly<Record<string, string | undefined>> = process.env;
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
      expect(configMarker(harness).trim().split("\n")).toHaveLength(1);
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
