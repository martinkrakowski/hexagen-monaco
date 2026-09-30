import { afterEach, describe, expect, test } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { errorText } from "../../src/internal/artifact.js";
import type { Config } from "../../src/internal/config.js";
import { LOCKED_INVARIANTS } from "../../src/internal/config.js";
import type { LogDirEnv } from "../../src/internal/logdir.js";
import { PLAN_REVIEW_LANE, rowHash, rowRisk } from "../../src/internal/rows.js";
import { runCli } from "../../src/plan-review/cli.js";

/**
 * The plan-review gate's command face.
 *
 * Ported from the source suite. Two changes the port requires:
 *
 * 1. Every test hands `runCli` a `config` and a `root` instead of letting the
 *    command find the planning directory from the working directory, so a temp
 *    directory can never walk up into a real checkout and find someone else's
 *    plan. `configFor` is the only place a config is built.
 * 2. The source's entry-guard tests asserted the `import.meta.url` guard. That
 *    guard is gone — `src/bins/plan-review.ts` is the only process entry, and
 *    tsup bundles the CLI into it, so a guard left in the CLI would run the
 *    whole command twice. The guard's tests became built-bin spawn tests
 *    ("the built bin"), asserting the same behaviour at the real entry.
 *
 * Every fixture id here is invented: lane rows are `RX-*`, the decision row is
 * `D42` (the grammar the CLI documents is `D` + digits), the wave is `wv-2`.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "plan-review-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

/** The overlay a test runs against. `repo` is invented and never queried. */
const configFor = (over: Partial<Config> = {}): Config => ({
  planDir: "docs/planning",
  gateSteps: [],
  requiredCheck: "^Build",
  forbiddenPorts: [],
  operatorDataPaths: [],
  mutate: false,
  overrides: [],
  invariants: { ...LOCKED_INVARIANTS },
  repo: "acme/demo",
  waveStatusPort: 4318,
  ...over,
});

const plan = [
  "# The plan",
  "",
  "| Lane | Delivers |",
  "|---|---|",
  "| **RX-1** | The display name, exposed and resolvable. |",
  "| **D42** | Create is a server call. |",
].join("\n");

const writePlan = (dir: string, text = plan): string => {
  const path = join(dir, "plan.md");
  writeFileSync(path, text);
  return path;
};

interface ReviewDetail {
  readonly plan: string;
  readonly reviewer: string;
  readonly rows: Record<string, string>;
  readonly decisions?: Record<string, string>;
  readonly verdict: string;
}

const reviewLine = (wave: string, detail: ReviewDetail): string =>
  `${JSON.stringify({
    ts: "2026-09-28T10:00:00Z",
    wave,
    lane: PLAN_REVIEW_LANE,
    stage: "plan-review",
    event: "settled",
    detail,
  })}\n`;

const dispatchLine = (wave: string, lane: string): string =>
  `${JSON.stringify({
    ts: "2026-09-28T11:00:00Z",
    wave,
    lane,
    stage: "dispatch",
    event: "started",
  })}\n`;

const io = (
  root: string,
  over: {
    readonly log?: string[];
    readonly errors?: string[];
    readonly env?: LogDirEnv;
  } = {},
) => ({
  argv: [] as readonly string[],
  config: configFor(),
  root,
  log: (text: string): void => void (over.log ?? []).push(text),
  logError: (text: string): void => void (over.errors ?? []).push(text),
  // The bin resolves every command-line path against the root (see
  // `src/bins/plan-review.ts`), so the fixture does the same: a repo-relative
  // plan path must be readable, and an absolute one must be left alone.
  readFile: (path: string) => readFile(resolve(root, path), "utf8"),
  // Log paths are the writer's: relative to the working directory, not the root.
  readLogFile: (path: string) => readFile(path, "utf8"),
  readdir: (dir: string) => readdir(dir),
  exists: (path: string): boolean => existsSync(path),
  env: over.env ?? {},
});

describe("runCli hashes", () => {
  test("prints the compact rows/decisions map for the given ids", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const log: string[] = [];
    const code = await runCli({
      ...io(dir, { log }),
      argv: ["hashes", planPath, "RX-1", "D42"],
    });
    expect(code).toBe(0);
    expect(log).toEqual([
      JSON.stringify({
        rows: { "RX-1": rowHash(plan, "RX-1") },
        decisions: { D42: rowHash(plan, "D42") },
        risk: { "RX-1": "normal" },
      }),
    ]);
  });

  test("an id where the D is not followed by a digit is a lane row, per the ^D\\d+ rule", async () => {
    const dir = tempDir();
    const planPath = writePlan(
      dir,
      `${plan}\n| **DECISION** | Not a decision row. |`,
    );
    const log: string[] = [];
    await runCli({
      ...io(dir, { log }),
      argv: ["hashes", planPath, "DECISION"],
    });
    expect(JSON.parse(log[0])).toEqual({
      rows: { DECISION: expect.any(String) },
      decisions: {},
      risk: { DECISION: "normal" },
    });
  });

  test("a row whose second cell is a bolded high reports risk high, alongside its hash", async () => {
    const dir = tempDir();
    const risky = [
      "| Lane | Risk | Delivers |",
      "|---|---|---|",
      "| **RX-1** | **high** | Split the shared index. |",
    ].join("\n");
    const planPath = writePlan(dir, risky);
    const log: string[] = [];
    await runCli({ ...io(dir, { log }), argv: ["hashes", planPath, "RX-1"] });
    expect(JSON.parse(log[0])).toEqual({
      rows: { "RX-1": rowHash(risky, "RX-1") },
      decisions: {},
      risk: { "RX-1": "high" },
    });
  });

  test("no plan argument prints usage and exits 2", async () => {
    const dir = tempDir();
    const errors: string[] = [];
    const code = await runCli({ ...io(dir, { errors }), argv: ["hashes"] });
    expect(code).toBe(2);
    expect(errors[0]).toContain("usage:");
  });

  test("the usage line names the bin, never a source alias", async () => {
    const dir = tempDir();
    const errors: string[] = [];
    await runCli({ ...io(dir, { errors }), argv: ["fingerprint", "p.md"] });
    expect(errors[0]).toContain("hexagen-orchestration-plan-review");
    expect(errors[0]).not.toContain("plan:review");
  });

  test("an unreadable plan rejects — the bin turns it into exit 1", async () => {
    const dir = tempDir();
    await expect(
      runCli({ ...io(dir), argv: ["hashes", "/nonexistent/plan.md", "RX-1"] }),
    ).rejects.toThrow(/nonexistent/);
  });

  test("an id with zero rows rejects instead of hashing a neighbouring line", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    await expect(
      runCli({ ...io(dir), argv: ["hashes", planPath, "RX-9"] }),
    ).rejects.toThrow(/found 0/);
  });

  test("an unknown subcommand prints usage and exits 2", async () => {
    const dir = tempDir();
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["fingerprint", "p.md"],
    });
    expect(code).toBe(2);
    expect(errors[0]).toContain("usage:");
  });
});

/**
 * A-1: a risk cell that reads like a risk word but is not one this package
 * accepts is a tier nobody cleared, and the command that reports tiers refuses
 * on it. At the source every `rowRisk` throw was swallowed and `hashes` exited
 * 0.
 */
describe("A-1: a malformed risk cell refuses every subcommand that reports a tier", () => {
  /** `high` plainly, with no bold markers — the shape that read as `normal`. */
  const plainHigh = [
    "| Lane | Risk | Delivers |",
    "|---|---|---|",
    "| **RX-1** | high | Split the shared index. |",
  ].join("\n");

  test("hashes returns 1 and names the row, instead of exiting 0", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir, plainHigh);
    const errors: string[] = [];
    const log: string[] = [];
    const code = await runCli({
      ...io(dir, { errors, log }),
      argv: ["hashes", planPath, "RX-1"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("RX-1");
    expect(log).toEqual([]);
  });

  test("hashes still refuses when a good row is listed alongside the bad one", async () => {
    const dir = tempDir();
    const planPath = writePlan(
      dir,
      `${plan}\n| **RX-2** | high | A plain high. |`,
    );
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["hashes", planPath, "RX-1", "RX-2"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("RX-2");
  });

  test("check returns 1 and names the row, once the hashes have already matched", async () => {
    // The settled review stores the plain-high row's own hash, with a clear
    // verdict and the same plan path — so the gate reaches the risk read and
    // would otherwise report the tier and return 0.
    const dir = tempDir();
    const planPath = writePlan(dir, plainHigh);
    const logdir = join(dir, "waves");
    mkdirSync(logdir, { recursive: true });
    writeFileSync(
      join(logdir, "events.jsonl"),
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plainHigh, "RX-1") },
        verdict: "clear",
      }),
    );
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("RX-1");
  });

  test("pre-pr-check returns 1 naming the plan file and the row", async () => {
    // The plan file sits in <root>/<planDir>, and the lane's row says `high`
    // plainly. `discoverRisk` rethrows the cell error with the file attached.
    const dir = tempDir();
    mkdirSync(join(dir, "docs", "planning"), { recursive: true });
    writeFileSync(join(dir, "docs", "planning", "the-plan.md"), plainHigh);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: [
        "pre-pr-check",
        "RX-1",
        "--wave",
        "wv-2",
        "--logdir",
        join(dir, "absent"),
      ],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("the-plan.md");
    expect(errors.join("\n")).toContain("RX-1");
  });

  test("a table with no risk column still reads as normal — prose is not a risk cell", async () => {
    // The counterweight, and a ported regression assertion: the cell holds the
    // Delivers prose, which has always read `normal`. It is not a red case for
    // this lane — `rowRisk` owns it, and this port cannot break it.
    const dir = tempDir();
    const planPath = writePlan(dir, plan);
    const log: string[] = [];
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { log, errors }),
      argv: ["hashes", planPath, "RX-1"],
    });
    expect(code).toBe(0);
    expect(JSON.parse(log[0]).risk).toEqual({ "RX-1": "normal" });
    expect(errors).toEqual([]);
  });
});

describe("runCli check", () => {
  const writeLog = (dir: string, lines: readonly string[]): string => {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "events.jsonl");
    writeFileSync(path, lines.join(""));
    return dir;
  };

  test("exit 0 when the verdict is clear and every reviewed hash still matches", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        decisions: { D42: rowHash(plan, "D42") },
        verdict: "clear",
      }),
    ]);
    const code = await runCli({
      ...io(dir),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(0);
  });

  test("check reports the row's risk once the plan is read", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
    ]);
    const log: string[] = [];
    const code = await runCli({
      ...io(dir, { log }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(0);
    expect(log).toContain(`risk: ${rowRisk(plan, "RX-1")}`);
  });

  test("exit 1 names the rows and decisions that changed since the review", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        decisions: { D42: rowHash(plan, "D42") },
        verdict: "clear",
      }),
    ]);
    const edited = plan.replace(
      "The display name, exposed",
      "The display name, hidden",
    );
    writePlan(dir, edited);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("RX-1");
  });

  test("exit 1 names a decision row that changed even when the lane row did not", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        decisions: { D42: rowHash(plan, "D42") },
        verdict: "clear",
      }),
    ]);
    writePlan(
      dir,
      plan.replace("Create is a server call.", "Create is a client call."),
    );
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("D42");
  });

  test("exit 1 when the lane row vanished from the plan after the review", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
    ]);
    writePlan(
      dir,
      plan.replace(
        "| **RX-1** | The display name, exposed and resolvable. |\n",
        "",
      ),
    );
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("no unambiguous row");
  });

  test("the latest review wins when a wave was reviewed twice", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const stale = rowHash(
      plan.replace("exposed and resolvable", "stale and unreviewed"),
      "RX-1",
    );
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "first",
        rows: { "RX-1": stale },
        verdict: "clear",
      }),
      reviewLine("W", {
        plan: planPath,
        reviewer: "second",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
    ]);
    const code = await runCli({
      ...io(dir),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(0);
  });

  test("exit 3 on changes-required", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "changes-required",
      }),
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(3);
    expect(errors.join("\n")).toContain("changes-required");
  });

  test("exit 2 when no review was recorded for the wave", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [dispatchLine("W", "RX-1")]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("no plan-review settled event");
  });

  test("a review of a different plan is no review for this lane, even with identical rows", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const other = join(dir, "other.md");
    writeFileSync(other, plan);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: other,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("no review for this lane");
    expect(errors.join("\n")).toContain("other.md");
  });

  test("a review that names no plan file is no review for this lane", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      `${JSON.stringify({
        ts: "2026-09-28T10:00:00Z",
        wave: "W",
        lane: PLAN_REVIEW_LANE,
        stage: "plan-review",
        event: "settled",
        detail: {
          reviewer: "reviewer-a",
          rows: { "RX-1": rowHash(plan, "RX-1") },
          verdict: "clear",
        },
      })}\n`,
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("names no plan file");
  });

  test("the plan compares against the repository root, not the working directory", async () => {
    // A bin invoked from a subdirectory must judge the same plan the operator's
    // editor shows: the review names it relative to the root, and the command
    // line names it absolutely.
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: relative(dir, planPath),
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
    ]);
    const code = await runCli({
      ...io(dir),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(0);
  });

  test("a repo-relative plan path on the command line resolves against the root", async () => {
    // The bin reads a repo-relative plan from the ROOT, so a review naming it
    // relative to the root and a command line naming it the same way agree.
    const dir = tempDir();
    mkdirSync(join(dir, "docs", "planning"), { recursive: true });
    writeFileSync(join(dir, "docs", "planning", "p.md"), plan);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: "docs/planning/p.md",
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: [
        "check",
        "docs/planning/p.md",
        "--logdir",
        logdir,
        "--wave",
        "W",
        "RX-1",
      ],
    });
    expect(code).toBe(0);
  });

  test("exit 2 when the events log is missing", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: [
        "check",
        planPath,
        "--logdir",
        join(dir, "absent"),
        "--wave",
        "W",
        "RX-1",
      ],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("could not read");
  });

  test("exit 2 when the lane is absent from the review's rows", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-2": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("absent from the review's rows");
  });

  test("exit 2 when the latest review's rows map is not a string map", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      `${JSON.stringify({
        ts: "2026-09-28T10:00:00Z",
        wave: "W",
        lane: PLAN_REVIEW_LANE,
        stage: "plan-review",
        event: "settled",
        detail: { plan: planPath, rows: { "RX-1": 7 }, verdict: "clear" },
      })}\n`,
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("no usable rows map");
  });

  test("exit 2 when the review carries no verdict", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      `${JSON.stringify({
        ts: "2026-09-28T10:00:00Z",
        wave: "W",
        lane: PLAN_REVIEW_LANE,
        stage: "plan-review",
        event: "settled",
        detail: { plan: planPath, rows: { "RX-1": rowHash(plan, "RX-1") } },
      })}\n`,
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("no verdict");
  });

  test("exit 1 when the verdict is neither clear nor changes-required", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "unclear",
      }),
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("neither clear nor changes-required");
  });

  test("exit 2 when the plan cannot be read", async () => {
    const dir = tempDir();
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: join(dir, "plan.md"),
        reviewer: "reviewer-a",
        rows: { "RX-1": "aa" },
        verdict: "clear",
      }),
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: [
        "check",
        join(dir, "plan.md"),
        "--logdir",
        logdir,
        "--wave",
        "W",
        "RX-1",
      ],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("could not read");
  });

  test("a present but malformed decisions map is a broken record, not no decisions", async () => {
    // A non-string decision hash must not read as "the review recorded no
    // decisions": the gate would stop comparing a decision row that changed.
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      `${JSON.stringify({
        ts: "2026-09-28T10:00:00Z",
        wave: "W",
        lane: PLAN_REVIEW_LANE,
        stage: "plan-review",
        event: "settled",
        detail: {
          plan: planPath,
          reviewer: "reviewer-a",
          rows: { "RX-1": rowHash(plan, "RX-1") },
          decisions: { D42: 7 },
          verdict: "clear",
        },
      })}\n`,
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("malformed decisions map");
  });

  test("a torn line newer than the review fails the gate, naming the line", async () => {
    // The review parsed, but the writer died mid-line after it: whatever the
    // tail held, the log cannot say the review is still the latest word.
    const dir = tempDir();
    const planPath = writePlan(dir);
    mkdirSync(join(dir, "waves"), { recursive: true });
    const logPath = join(dir, "waves", "events.jsonl");
    writeFileSync(
      logPath,
      `${reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      })}{"ts":"2026-09-28T10:00:01Z","wave":"W"`,
    );
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: [
        "check",
        planPath,
        "--logdir",
        join(dir, "waves"),
        "--wave",
        "W",
        "RX-1",
      ],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("unreadable line(s) 2");
  });

  test("a rejected line newer than the review fails the gate", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
      `${JSON.stringify({
        ts: "2026-09-28T10:00:01Z",
        wave: "W",
        lane: PLAN_REVIEW_LANE,
        stage: "plan-review",
        event: "skipped",
      })}\n`,
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("unreadable line(s) 2");
  });

  test("an unreadable line older than the review does not block — the review supersedes it", async () => {
    const dir = tempDir();
    const planPath = writePlan(dir);
    const logdir = writeLog(join(dir, "waves"), [
      "\n",
      '{"ts":"2026-09-28T09:00:00Z","wave":"W"',
      "\n",
      reviewLine("W", {
        plan: planPath,
        reviewer: "reviewer-a",
        rows: { "RX-1": rowHash(plan, "RX-1") },
        verdict: "clear",
      }),
    ]);
    const code = await runCli({
      ...io(dir),
      argv: ["check", planPath, "--logdir", logdir, "--wave", "W", "RX-1"],
    });
    expect(code).toBe(0);
  });

  test.each([
    ["a missing --logdir value", ["check", "p.md", "--logdir"]],
    [
      "an unknown option",
      ["check", "p.md", "--logdir", "d", "--wave", "W", "--pr", "1", "RX-1"],
    ],
    ["too few positionals", ["check", "p.md", "--logdir", "d", "--wave", "W"]],
    ["flags without values", ["check", "p.md", "--wave", "W", "RX-1"]],
    ["no --wave at all", ["check", "p.md", "--logdir", "d", "RX-1"]],
  ])("usage error — %s — exits 2 with usage", async (_name, argv) => {
    const dir = tempDir();
    const errors: string[] = [];
    const code = await runCli({ ...io(dir, { errors }), argv });
    expect(code).toBe(2);
    expect(errors[0]).toContain("usage:");
  });
});

describe("runCli pre-pr-check", () => {
  /** A temp repository root with an empty `<planDir>/`, which is what the gate greps. */
  const planningRoot = (planDir = "docs/planning"): string => {
    const dir = tempDir();
    mkdirSync(join(dir, planDir), { recursive: true });
    return dir;
  };

  const writePlanningFile = (dir: string, name: string, text: string): void => {
    writeFileSync(join(dir, "docs", "planning", name), text);
  };

  const highPlan = [
    "| Lane | Risk | Delivers |",
    "|---|---|---|",
    "| **RX-1** | **high** | Split the shared index. |",
  ].join("\n");

  const writeLogdir = (dir: string, lines: readonly string[]): string => {
    const logdir = join(dir, "waves");
    mkdirSync(logdir, { recursive: true });
    writeFileSync(join(logdir, "events.jsonl"), lines.join(""));
    return logdir;
  };

  const preprReviewLine = (verdict: string): string =>
    `${JSON.stringify({
      ts: "2026-09-29T10:00:00Z",
      wave: "wv-2",
      lane: "RX-1",
      stage: "review",
      event: "settled",
      detail: { verdict },
    })}\n`;

  const remediateLine = (): string =>
    `${JSON.stringify({
      ts: "2026-09-29T11:00:00Z",
      wave: "wv-2",
      lane: "RX-1",
      stage: "remediate",
      event: "settled",
    })}\n`;

  test("a normal-risk lane passes without reading any wave log at all", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", plan); // RX-1 has no Risk column — normal
    const code = await runCli({
      ...io(dir),
      argv: [
        "pre-pr-check",
        "RX-1",
        "--wave",
        "wv-2",
        "--logdir",
        join(dir, "absent"),
      ],
    });
    expect(code).toBe(0);
  });

  test("a lane found in no plan refuses — fail closed, never counted as normal", async () => {
    const dir = planningRoot();
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["pre-pr-check", "RX-9", "--wave", "wv-2"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("no plan row for lane RX-9");
    expect(errors.join("\n")).toContain("docs/planning");
  });

  test("an unreadable planning directory refuses the same way as a lane found in no plan", async () => {
    // Remove the planning directory this suite always creates, so discoverRisk's
    // own readdir genuinely fails.
    const dir = planningRoot();
    rmSync(join(dir, "docs", "planning"), { recursive: true, force: true });
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2"],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("no plan row for lane RX-1");
  });

  test("the planning directory comes from the overlay, not a constant", async () => {
    // `planDir: notes` moves the whole gate, and the refusal names the setting's
    // value. At the source this was a hardcoded directory read from the working
    // directory, which is why a packaged tool could only work on one project.
    const dir = tempDir();
    mkdirSync(join(dir, "notes"), { recursive: true });
    writeFileSync(join(dir, "notes", "plan.md"), plan);
    const errors: string[] = [];
    const found = await runCli({
      ...io(dir, { errors }),
      config: configFor({ planDir: "notes" }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2"],
    });
    expect(found).toBe(0);

    const missing = await runCli({
      ...io(dir, { errors }),
      config: configFor({ planDir: "elsewhere" }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2"],
    });
    expect(missing).toBe(1);
    expect(errors.join("\n")).toContain("elsewhere");
  });

  test("a review settled with no verdict at all (the finding-count shape a review bot emits) refuses", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const logdir = writeLogdir(dir, [
      `${JSON.stringify({
        ts: "2026-09-29T10:00:00Z",
        wave: "wv-2",
        lane: "RX-1",
        stage: "review",
        event: "settled",
        detail: { bug: 1, suggestion: 2, nit: 0 },
      })}\n`,
    ]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2", "--logdir", logdir],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("no verdict recorded");
  });

  test("a review settled with an unrecognised verdict refuses, naming it", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const logdir = writeLogdir(dir, [preprReviewLine("approved")]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2", "--logdir", logdir],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("unrecognised verdict");
    expect(errors.join("\n")).toContain("approved");
  });

  test("a torn line after the governing review refuses — the log's own word is unknown", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const logdir = join(dir, "waves");
    mkdirSync(logdir, { recursive: true });
    writeFileSync(
      join(logdir, "events.jsonl"),
      `${preprReviewLine("clear")}{"ts":"2026-09-29T10:00:01Z","wave":"wv-2"`,
    );
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2", "--logdir", logdir],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("unreadable line(s) 2");
    expect(errors.join("\n")).toContain("the log tail cannot be read");
  });

  test("a torn line BEFORE the governing review does not block — the review supersedes it", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const logdir = join(dir, "waves");
    mkdirSync(logdir, { recursive: true });
    writeFileSync(
      join(logdir, "events.jsonl"),
      `{"ts":"2026-09-29T09:00:00Z","wave":"wv-2"\n${preprReviewLine("clear")}`,
    );
    const code = await runCli({
      ...io(dir),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2", "--logdir", logdir],
    });
    expect(code).toBe(0);
  });

  test("a high-risk lane with a clear pre-PR review passes", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const logdir = writeLogdir(dir, [preprReviewLine("clear")]);
    const code = await runCli({
      ...io(dir),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2", "--logdir", logdir],
    });
    expect(code).toBe(0);
  });

  test("a high-risk lane with no stage=review event refuses, naming it", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const logdir = writeLogdir(dir, []);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2", "--logdir", logdir],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("no stage=review event=settled");
    expect(errors.join("\n")).toContain("RX-1");
  });

  test("changes-required with no later remediate settled refuses", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const logdir = writeLogdir(dir, [preprReviewLine("changes-required")]);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2", "--logdir", logdir],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("changes-required");
  });

  test("changes-required with a LATER remediate settled passes", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const logdir = writeLogdir(dir, [
      preprReviewLine("changes-required"),
      remediateLine(),
    ]);
    const code = await runCli({
      ...io(dir),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2", "--logdir", logdir],
    });
    expect(code).toBe(0);
  });

  test("an unreadable events log for a high-risk lane refuses (fail closed), not a usage error", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const errors: string[] = [];
    const code = await runCli({
      ...io(dir, { errors }),
      argv: [
        "pre-pr-check",
        "RX-1",
        "--wave",
        "wv-2",
        "--logdir",
        join(dir, "absent"),
      ],
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("could not read");
  });

  test("--logdir omitted resolves through WAVE_LOG_ROOT, with the overlay's repo and waveLogDir", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const root = join(dir, "waveroot");
    const logdir = join(root, "wave-wv-2");
    mkdirSync(logdir, { recursive: true });
    writeFileSync(join(logdir, "events.jsonl"), preprReviewLine("clear"));
    const code = await runCli({
      ...io(dir, { env: { WAVE_LOG_ROOT: root } }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2"],
    });
    expect(code).toBe(0);
  });

  test("--logdir omitted and WAVE_LOG_ROOT unset resolves under the overlay's waveLogDir, never HOME", async () => {
    const dir = planningRoot();
    writePlanningFile(dir, "plan.md", highPlan);
    const waveLogDir = join(dir, "logs");
    const logdir = join(waveLogDir, "wave-wv-2");
    mkdirSync(logdir, { recursive: true });
    writeFileSync(join(logdir, "events.jsonl"), preprReviewLine("clear"));
    // An isolated HOME: nothing this test asserts may depend on the host's own
    // log root, and the shared, un-suffixed home log root is not a candidate at
    // any rate — every root this package resolves is per-repository.
    const home = join(dir, "isolated-home");
    mkdirSync(home, { recursive: true });
    const code = await runCli({
      ...io(dir, { env: { HOME: home } }),
      config: configFor({ waveLogDir }),
      argv: ["pre-pr-check", "RX-1", "--wave", "wv-2"],
    });
    expect(code).toBe(0);
  });

  test.each([
    ["no positional lane", ["pre-pr-check", "--wave", "wv-2"]],
    ["no --wave at all", ["pre-pr-check", "RX-1"]],
    ["a missing --wave value", ["pre-pr-check", "RX-1", "--wave"]],
    [
      "an unknown flag",
      ["pre-pr-check", "RX-1", "--wave", "wv-2", "--plan", "p.md"],
    ],
    [
      "too many positionals",
      ["pre-pr-check", "RX-1", "RX-2", "--wave", "wv-2"],
    ],
  ])("usage error — %s — exits 2 with usage", async (_name, argv) => {
    const dir = planningRoot();
    const errors: string[] = [];
    const code = await runCli({ ...io(dir, { errors }), argv });
    expect(code).toBe(2);
    expect(errors[0]).toContain("usage:");
  });
});

describe("errorText", () => {
  test("an Error's message", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
  });

  test("an Error with no message falls back to its name", () => {
    expect(errorText(new Error())).toBe("Error");
  });

  test("a thrown string is its own text", () => {
    expect(errorText("boom")).toBe("boom");
  });

  test("anything else is stringified", () => {
    expect(errorText(7)).toBe("7");
  });
});

/**
 * The built bin.
 *
 * The source's entry guard is gone: tsup bundles this CLI module into
 * `dist/bins/plan-review.js`, so a guard left in the module would be TRUE
 * inside the bundle and run the command twice. `src/bins/plan-review.ts` is the
 * only process entry. These tests spawn the real built bin and assert the same
 * behaviour the guard's tests did.
 */
describe("the built bin", () => {
  const bin = (): string => resolve(PACKAGE_ROOT, "dist/bins/plan-review.js");

  const run = (
    cwd: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv = {},
  ) =>
    spawnSync(process.execPath, [bin(), ...args], {
      cwd,
      encoding: "utf8",
      env: { ...env },
    });

  /** A git repository with an overlay and a plan, so the bin finds both. */
  const repository = (config?: string): string => {
    const root = tempDir();
    expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
    mkdirSync(join(root, "docs", "planning"), { recursive: true });
    writeFileSync(join(root, "docs", "planning", "plan.md"), plan);
    if (config !== undefined) {
      mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
      writeFileSync(join(root, ".agents/orchestration/config.yaml"), config);
    }
    return root;
  };

  test("the plan is read from the repository root, not the working directory", () => {
    const root = repository("repo: acme/demo\nplanDir: docs/planning\n");
    const sub = join(root, "packages", "deep");
    mkdirSync(sub, { recursive: true });
    const result = run(sub, ["hashes", "docs/planning/plan.md", "RX-1"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      rows: { "RX-1": rowHash(plan, "RX-1") },
      decisions: {},
      risk: { "RX-1": "normal" },
    });
  });

  test("a present overlay with problems refuses before any subcommand runs", () => {
    const root = repository("repo: acme/demo\nnope: 1\n");
    const result = run(root, ["hashes", "docs/planning/plan.md", "RX-1"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nope");
    expect(result.stdout).toBe("");
  });

  test("pre-pr-check wires the real readdir, and a normal lane passes", () => {
    const root = repository("repo: acme/demo\nplanDir: docs/planning\n");
    const result = run(root, ["pre-pr-check", "RX-1", "--wave", "wv-2"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("risk=normal");
  });

  test("pre-pr-check wires the real LOGDIR from the process", () => {
    const root = repository("repo: acme/demo\nplanDir: docs/planning\n");
    writeFileSync(
      join(root, "docs", "planning", "plan.md"),
      [
        "| Lane | Risk | Delivers |",
        "|---|---|---|",
        "| **RX-1** | **high** | Split. |",
      ].join("\n"),
    );
    const logdir = join(root, "custom-logdir");
    mkdirSync(logdir, { recursive: true });
    writeFileSync(
      join(logdir, "events.jsonl"),
      `${JSON.stringify({
        ts: "2026-09-29T10:00:00Z",
        wave: "wv-2",
        lane: "RX-1",
        stage: "review",
        event: "settled",
        detail: { verdict: "clear" },
      })}\n`,
    );
    // No --logdir flag: only $LOGDIR can make this resolve to the events written.
    const result = run(root, ["pre-pr-check", "RX-1", "--wave", "wv-2"], {
      LOGDIR: logdir,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("risk=high");
  });

  test("a relative --logdir reads the events.jsonl wave-event wrote from the same directory", () => {
    const root = repository("repo: acme/demo\nplanDir: docs/planning\n");
    writeFileSync(
      join(root, "docs", "planning", "plan.md"),
      [
        "| Lane | Risk | Delivers |",
        "|---|---|---|",
        "| **RX-1** | **high** | Split. |",
      ].join("\n"),
    );
    const sub = join(root, "packages", "deep");
    mkdirSync(sub, { recursive: true });
    const writer = resolve(PACKAGE_ROOT, "dist/bins/wave-event.js");
    const written = spawnSync(
      process.execPath,
      [
        writer,
        "--logdir",
        "wave-logs",
        "wv-2",
        "RX-1",
        "review",
        "settled",
        "--detail",
        '{"verdict":"clear"}',
      ],
      { cwd: sub, encoding: "utf8", env: {} },
    );
    expect(written.status, written.stderr).toBe(0);
    // The writer put it under the CWD, not under the repository root.
    expect(existsSync(join(sub, "wave-logs", "events.jsonl"))).toBe(true);
    expect(existsSync(join(root, "wave-logs"))).toBe(false);
    const result = run(sub, [
      "pre-pr-check",
      "RX-1",
      "--wave",
      "wv-2",
      "--logdir",
      "wave-logs",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("risk=high");
  });

  test("a plain-high risk cell refuses the built bin with 1 and the row named", () => {
    const root = repository("repo: acme/demo\nplanDir: docs/planning\n");
    writeFileSync(
      join(root, "docs", "planning", "plan.md"),
      [
        "| Lane | Risk | Delivers |",
        "|---|---|---|",
        "| **RX-1** | high | Split. |",
      ].join("\n"),
    );
    const result = run(root, ["pre-pr-check", "RX-1", "--wave", "wv-2"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("plan.md");
    expect(result.stderr).toContain("RX-1");
  });

  test("a usage error through the real bin sets its own exit code", () => {
    const root = repository();
    const result = run(root, ["hashes"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("hexagen-orchestration-plan-review");
  });

  test("a command that throws prints the error and exits 2 — could not run, which is not a refusal", () => {
    const root = repository();
    const result = run(root, ["hashes", "docs/planning/absent.md", "RX-1"]);
    // 1 is a refusal (merge-prs stops on it as a verdict); a crash is "could
    // not run", the same class as a usage error.
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/absent\.md/);
  });
});
