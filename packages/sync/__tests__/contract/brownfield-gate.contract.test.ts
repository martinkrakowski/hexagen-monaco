/**
 * The brownfield CI gate, run step by step against the BUILT artifact (kit
 * plan 5 §4.1.2, §6).
 *
 * The subject is not `hexagen` here — it is `docs/ci/brownfield-gate.yml`. This
 * suite reads that workflow, extracts each step's `run:` script, substitutes
 * the expressions a runner would substitute, and executes the result with bash
 * from the fixture root, so the shell under test is the one a client job runs.
 * A hand-copied copy of the scripts would pass while the workflow rotted, which
 * is the failure this suite exists to prevent (plan 5 §7: "Keeping the recipe
 * and the commands in sync: the fixture test is the guard"), so the steps are
 * read from the file, never copied.
 *
 * The fixture is a client repo on the published layout
 * (`../helpers/published-layout.ts`): the built `dist` copied into
 * `node_modules/@hexagen-monaco/sync`, its four tsup externals linked beside it
 * (ADR-0068), a `.bin/hexagen` shim so the scripts' bare `hexagen` resolves,
 * and NO `.architecture/manifest.yaml`, no `packages/`, no `apps/web` — the
 * shape a repo that holds only `.hexagen/` has. That absence is load-bearing
 * twice over: it is acceptance test 9, and `isRepoMode` reads the manifest to
 * choose key resolution, so a fixture that kept one would make every command
 * under test look for a repo-mode key a client cannot have.
 *
 * One fixture for the whole suite, built once and reset with git per test:
 * `createPublishedLayoutFixture` copies the built dist and links its externals,
 * which is far too much work to repeat per case, and everything the gate writes
 * is committed, so `git reset --hard` restores the working tree.
 *
 * POSIX-only, and the reason is the subject: the workflow declares
 * `runs-on: ubuntu-latest` and its steps use bash-only constructs (process
 * substitution, arrays, `shopt`, `install`). Running something else on win32
 * would test a shell no client runs, which is the drift this suite exists to
 * catch — so it reports a skip there instead.
 */
import assert from "node:assert/strict";
import { describe, it, beforeAll, beforeEach, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  appendChainedLine,
  lineHash,
  signTip,
} from "@hexagen/shared/node/trace-chain";
import { canonicalGrantPayload } from "../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../src/commands/grant/sign.js";
import {
  EXTERNALS,
  REPO_ROOT,
  SKIP_NON_POSIX,
  assertBuiltArtifactsPresent,
  cleanupFixture,
  createPublishedLayoutFixture,
  describeResult,
  runHexagen,
  runProcess,
  writeBinStub,
  type ContractFixture,
} from "../helpers/published-layout.js";
import { pathExists } from "../helpers/fs-helpers.js";

const WORKFLOW_FILE = path.join(REPO_ROOT, "docs", "ci", "brownfield-gate.yml");
const RECIPE_FILE = path.join(
  REPO_ROOT,
  "docs",
  "ci",
  "brownfield-gate-recipe.md",
);

const KEY = "b7".repeat(32);
const CALL_TIME = "2026-10-01T10:00:00.000Z";
const EXPIRES = "2026-12-01T00:00:00.000Z";
const SLICE_ID = "eng-1";
const GRANT_ID = "grant-1";
const TIP = ".hexagen/evidence/tip.json";
const TRACE = ".hexagen/evidence/trace.jsonl";
/** Where the workflow's step 4 writes its bundle; the runner throws it away. */
const BUNDLE = ".hexagen/ci-evidence-bundle.zip";

const RESOLVE = "Resolve the base commit";
const STEP_0 = "step 0: the .hexagen/ inputs must be tracked";
const STEP_1 = "step 1: observe";
const STEP_2 = "step 2: slice check (drift report, not a gate)";
const STEP_3 = "step 3: contract check --base <pinned base>";
const KEY_STEP = "Inject the engagement key";
const STEP_4 = "step 4: evidence pack";
const STEP_4B = "step 4b: evidence verify --since <base>";
const FINGERPRINT = "Key fingerprint (report only)";

// ─── the workflow, read from the file ─────────────────────────────────────────

interface WorkflowStep {
  readonly name: string;
  readonly id?: string;
  readonly uses?: string;
  readonly if?: string;
  readonly run?: string;
  /** Dashed, as GitHub spells it — and as the only place a step opts out. */
  readonly "continue-on-error"?: boolean;
  readonly env?: Readonly<Record<string, string>>;
}

interface Workflow {
  readonly env: Readonly<Record<string, string>>;
  readonly steps: readonly WorkflowStep[];
}

function readWorkflow(): Workflow {
  const doc = yaml.load(readFileSync(WORKFLOW_FILE, "utf8")) as {
    jobs?: Record<string, { steps?: unknown }>;
    env?: Record<string, string>;
    permissions?: unknown;
  };
  const jobs = Object.keys(doc.jobs ?? {});
  assert.deepEqual(jobs, ["brownfield-gate"], `${WORKFLOW_FILE} job list`);
  const steps = doc.jobs?.["brownfield-gate"]?.steps;
  assert.ok(
    Array.isArray(steps) && steps.length > 0,
    `${WORKFLOW_FILE} has no steps to run`,
  );
  const env = doc.env ?? {};
  // The job reads the checkout and publishes nothing: plan 5 acceptance test 10.
  // Nothing here needs more, and a widened `permissions:` block would grant a
  // client repo's CI more than this recipe says it uses.
  assert.deepEqual(
    doc.permissions,
    { contents: "read" },
    `${WORKFLOW_FILE} permissions must be exactly contents: read`,
  );
  assertCliPinCarriesEveryCommand(env);
  return { env, steps: steps as readonly WorkflowStep[] };
}

/**
 * The CLI version the install step pins has to carry every command the job runs.
 *
 * `contract check --base` (the growth guard, step 3) and `evidence verify` (the
 * coverage check, step 4b) first appear in 0.14.0; a pin below that installs a
 * CLI that exits at its own command parser, so steps 3 and 4b fail for a reason
 * that has nothing to do with the change under review — the gate would be red
 * and saying nothing. The assertion is on the pin, not on what is installed:
 * the fixture runs the dist built from this repository, which is what makes the
 * steps testable at all.
 */
const MINIMUM_CLI_VERSION = [0, 14, 0] as const;

function assertCliPinCarriesEveryCommand(
  env: Readonly<Record<string, string>>,
): void {
  const pin = env.HEXAGEN_VERSION;
  assert.ok(
    typeof pin === "string",
    `${WORKFLOW_FILE} has no HEXAGEN_VERSION pin; the install step needs one`,
  );
  const parsed = /^(\d+)\.(\d+)\.(\d+)/.exec(pin as string);
  assert.ok(
    parsed !== null,
    `HEXAGEN_VERSION "${pin}" is not a version this check can read`,
  );
  const at = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  const floor = MINIMUM_CLI_VERSION;
  const below =
    at[0] < floor[0] ||
    (at[0] === floor[0] && at[1] < floor[1]) ||
    (at[0] === floor[0] && at[1] === floor[1] && at[2] < floor[2]);
  assert.ok(
    !below,
    `HEXAGEN_VERSION is pinned to "${pin}", below ${floor.join(".")}: steps 3 and 4b call \`contract check --base\` and \`evidence verify\`, which first ship in ${floor.join(".")}, so the installed CLI would exit at its command parser instead of judging anything`,
  );
}

/**
 * Every step the example workflow has, in order.
 *
 * Guarded, not assumed: `runGate` compares this list against the file's, so a
 * step added to the workflow without a case here fails the suite instead of
 * quietly going unexecuted, and a step removed or renamed fails it too. The
 * workflow is the subject under test, and a suite that had drifted to running
 * half of it would be the drift it guards.
 */
const EXPECTED_STEPS = [
  "Checkout the repository",
  "Setup Node.js",
  "Install the hexagen CLI",
  "Resolve the base commit",
  STEP_0,
  STEP_1,
  STEP_2,
  STEP_3,
  KEY_STEP,
  STEP_4,
  STEP_4B,
  FINGERPRINT,
];

const STEPS_WITH_A_REPORTED_EXIT = [
  STEP_0,
  STEP_1,
  STEP_2,
  STEP_3,
  STEP_4,
  STEP_4B,
];

/**
 * The one step the fixture does not run: it installs the CLI from npm at the
 * pinned version, and the fixture already holds the artifact that install
 * fetches — the built dist, physically copied into the consumer's
 * `node_modules/@hexagen-monaco/sync` (see this file's header). Every kit
 * command, and every step that can decide the job, runs the workflow's own
 * shell.
 */
const NOT_RUN_HERE = new Set(["Install the hexagen CLI"]);

function assertWorkflowShape(wf: Workflow): void {
  assert.deepEqual(
    wf.steps.map((step) => step.name),
    EXPECTED_STEPS,
    `${WORKFLOW_FILE} no longer has the steps this suite runs: update EXPECTED_STEPS, and add a case for whatever changed`,
  );
}

// ─── expressions and conditions ───────────────────────────────────────────────

/** `${{ expr }}` → the value a runner supplies. Anything else is refused. */
function substitute(
  text: string,
  values: Readonly<Record<string, string>>,
): string {
  const out = text.replace(/\$\{\{([^}]*)\}\}/g, (_match, expr: string) => {
    const key = expr.trim();
    const value = values[key];
    if (value === undefined) {
      throw new Error(
        `the workflow uses an expression this harness does not supply: \${{ ${key} }}`,
      );
    }
    return value;
  });
  // The regex leaves text it does not match alone, and a substituted value could
  // itself hold `${{`. Either way the step must never receive one.
  assert.ok(
    !out.includes("${{"),
    `an expression survived substitution: ${JSON.stringify(out)}`,
  );
  return out;
}

/**
 * The step conditions this suite evaluates: `always()`, and `==` / `!=` against
 * a job env value or a step output. An unrecognised form throws rather than
 * defaulting to "run it" — a step the harness believed it ran (or skipped) is a
 * step nobody tested.
 */
const IF_COMPARE =
  /^(?:env\.([A-Za-z_][A-Za-z0-9_]*)|steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.([A-Za-z_][A-Za-z0-9_-]*))\s*(==|!=)\s*'([^']*)'$/;

function stepIsEnabled(
  step: WorkflowStep,
  values: Readonly<Record<string, string>>,
): boolean {
  if (step.if === undefined) return true;
  const expr = step.if.trim();
  if (expr === "always()") return true;
  const match = IF_COMPARE.exec(expr);
  if (match === null) {
    throw new Error(
      `the gate harness cannot evaluate the step condition \`if: ${expr}\`; extend it rather than guessing`,
    );
  }
  const actual =
    match[1] !== undefined
      ? values[match[1]]
      : values[`steps.${match[2]}.outputs.${match[3]}`];
  return match[4] === "==" ? actual === match[5] : actual !== match[5];
}

/** A `GITHUB_OUTPUT` / `GITHUB_ENV` file: one `name=value` per line. */
function readRunnerEnvFile(file: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {}; // a step that wrote nothing leaves the file absent
  }
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const eq = line.indexOf("=");
    assert.notEqual(eq, -1, `${file} holds a line with no '=': ${line}`);
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// ─── running the job ──────────────────────────────────────────────────────────

export interface StepResult {
  readonly name: string;
  /** null when the step did not run: an action, an `if:`, or after the stop. */
  readonly code: number | null;
  readonly out: string;
  /** Why it ran, or why it did not: action, not run here, if, after the stop. */
  readonly why: string;
}

export interface GateResult {
  /** What the runner would report for the job. */
  readonly jobExit: number;
  readonly steps: readonly StepResult[];
  /** The first blocking step whose exit decided the job. */
  readonly stoppedAt?: string;
  readonly log: string;
}

interface GateOptions {
  /** The PR base SHA, from the event payload. */
  readonly base: string;
  /** The HEXAGEN_GRANT_KEY secret; "" is the empty-secret case. */
  readonly secret?: string;
  /**
   * Model a job the key never reached: nothing sets HEXAGEN_GRANT_KEY_FILE and
   * HOME holds no `<engagement>.key`, so the CLI's own key resolution finds
   * nothing. The workflow never reaches this state — its key step exits 2
   * first — so it is opt-in, and used to pin the commands' own precondition.
   */
  readonly noKey?: boolean;
}

const tmpDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A runner's environment: the fixture's bin first, and a HOME with no key. */
async function runnerEnv(prefix: string): Promise<Record<string, string>> {
  const runnerTemp = await tempDir(prefix);
  return {
    PATH: `${binDir()}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: await tempDir("hexagen-gate-home-"),
    RUNNER_TEMP: runnerTemp,
    GITHUB_OUTPUT: path.join(runnerTemp, "github-output"),
    GITHUB_ENV: path.join(runnerTemp, "github-env"),
    CI: "1",
  };
}

/**
 * Run the workflow's steps in order, and report what the job would report.
 *
 * The runner's semantics: a step's `if` decides whether it runs; the first
 * non-zero exit from a step that is not `continue-on-error` stops the job and
 * becomes the job's exit code; and a step marked `always()` still runs
 * afterwards without being able to change that verdict.
 */
async function runGate(opts: GateOptions): Promise<GateResult> {
  const wf = readWorkflow();
  assertWorkflowShape(wf);
  const runner = await runnerEnv("hexagen-gate-runner-");
  const outputsFile = runner.GITHUB_OUTPUT as string;
  const { secret = KEY } = opts;

  const env: Record<string, string> = { ...runner };
  const values: Record<string, string> = {
    ...wf.env,
    "github.event_name": "pull_request",
    "github.event.pull_request.base.sha": opts.base,
    "secrets.HEXAGEN_GRANT_KEY": secret,
  };

  const results: StepResult[] = [];
  let jobExit = 0;
  let stoppedAt: string | undefined;
  for (const step of wf.steps) {
    if (step.uses !== undefined) {
      results.push({ name: step.name, code: null, out: "", why: "action" });
      continue;
    }
    if (NOT_RUN_HERE.has(step.name)) {
      results.push({
        name: step.name,
        code: null,
        out: "",
        why: "not run here",
      });
      continue;
    }
    if (stoppedAt !== undefined && step.if?.trim() !== "always()") {
      results.push({
        name: step.name,
        code: null,
        out: "",
        why: "after the stop",
      });
      continue;
    }
    if (!stepIsEnabled(step, values)) {
      results.push({ name: step.name, code: null, out: "", why: "if" });
      continue;
    }
    assert.ok(
      step.run !== undefined,
      `${step.name} has neither uses: nor run:`,
    );
    const stepEnv = { ...env };
    for (const [name, value] of Object.entries(step.env ?? {})) {
      stepEnv[name] = substitute(value, values);
    }
    const script = substitute(step.run, values);
    const r = await runProcess("bash", ["-e", "-c", script], fix.root, stepEnv);
    results.push({
      name: step.name,
      code: r.code,
      out: `${r.stdout}${r.stderr}`,
      why: "ran",
    });
    // What a step wrote is what the next step reads.
    if (step.id !== undefined) {
      for (const [name, value] of Object.entries(
        readRunnerEnvFile(outputsFile),
      )) {
        values[`steps.${step.id}.outputs.${name}`] = value;
      }
    }
    Object.assign(env, readRunnerEnvFile(runner.GITHUB_ENV as string));
    if (
      r.code !== 0 &&
      step["continue-on-error"] !== true &&
      stoppedAt === undefined
    ) {
      jobExit = r.code;
      stoppedAt = step.name;
    }
  }
  return {
    jobExit,
    steps: results,
    ...(stoppedAt === undefined ? {} : { stoppedAt }),
    log: results.map((r) => `── ${r.name} [${r.why}] ──\n${r.out}`).join("\n"),
  };
}

/**
 * One step of the workflow, on its own. Any earlier step that publishes an
 * output (`id:`) is run first, so the values this step's `if` and its
 * `${{ }}` expressions read are the ones the workflow would have produced —
 * seeded by hand, they would be the harness's opinion of the base rather than
 * the probe's.
 */
async function runStep(name: string, opts: GateOptions): Promise<StepResult> {
  const wf = readWorkflow();
  assertWorkflowShape(wf);
  const target = wf.steps.findIndex((s) => s.name === name);
  assert.notEqual(target, -1, `the workflow has no step named ${name}`);
  const step = wf.steps[target] as WorkflowStep;
  assert.ok(step.run !== undefined, `${name} has no run:`);
  const runner = await runnerEnv("hexagen-gate-step-");
  const values: Record<string, string> = {
    ...wf.env,
    "github.event_name": "pull_request",
    "github.event.pull_request.base.sha": opts.base,
    "secrets.HEXAGEN_GRANT_KEY": opts.secret ?? KEY,
  };
  const env: Record<string, string> = { ...runner };
  if (opts.noKey !== true) {
    // The key the job's own key step would have written to RUNNER_TEMP.
    const keyFile = path.join(runner.RUNNER_TEMP as string, "engagement.key");
    await fs.writeFile(keyFile, `${KEY}\n`, { mode: 0o600 });
    env.HEXAGEN_GRANT_KEY_FILE = keyFile;
  }

  for (const [key, value] of Object.entries(step.env ?? {})) {
    env[key] = substitute(value, values);
  }
  // The publish-output steps that come before this one.
  for (const before of wf.steps.slice(0, target)) {
    if (before.id === undefined || before.run === undefined) continue;
    const r = await runProcess(
      "bash",
      ["-e", "-c", substitute(before.run, values)],
      fix.root,
      env,
    );
    assert.equal(
      r.code,
      0,
      `${before.name} exited ${r.code}, so ${name} would never run:\n${r.stdout}${r.stderr}`,
    );
    for (const [key, value] of Object.entries(
      readRunnerEnvFile(runner.GITHUB_OUTPUT as string),
    )) {
      values[`steps.${before.id}.outputs.${key}`] = value;
    }
    Object.assign(env, readRunnerEnvFile(runner.GITHUB_ENV as string));
  }
  // A disabled step does not run, so its output never becomes a result here.
  if (!stepIsEnabled(step, values)) {
    return { name, code: null, out: "", why: "if" };
  }
  const r = await runProcess(
    "bash",
    ["-e", "-c", substitute(step.run, values)],
    fix.root,
    env,
  );
  return { name, code: r.code, out: `${r.stdout}${r.stderr}`, why: "ran" };
}

// ─── reading a run ────────────────────────────────────────────────────────────

const dump = (run: GateResult | StepResult): string =>
  "steps" in run ? run.log : run.out;

/** The named step, and that it ran. */
function ran(run: GateResult, name: string): StepResult {
  const step = run.steps.find((s) => s.name === name);
  assert.ok(
    step !== undefined,
    `no step named ${name} in the run:\n${dump(run)}`,
  );
  assert.equal(
    step.why,
    "ran",
    `${name} did not run (${step.why}):\n${dump(run)}`,
  );
  return step;
}

/** The named step, and that it did not run. */
function skipped(run: GateResult, name: string): StepResult {
  const step = run.steps.find((s) => s.name === name);
  assert.ok(
    step !== undefined,
    `no step named ${name} in the run:\n${dump(run)}`,
  );
  assert.notEqual(
    step.why,
    "ran",
    `${name} ran but must not have:\n${dump(run)}`,
  );
  return step;
}

/** The warning about a base that carries no trace, wherever it is printed. */
const MISSING_TRACE_WARNING = /carries no \.hexagen\/evidence\/trace\.jsonl/;

/**
 * The code a step REPORTED, read from its own `step <n> exit <code>` line —
 * what a reader of a CI log reads, and for the non-blocking step 2 not the code
 * the step returned.
 */
function reportedExit(step: StepResult): number {
  const match = /^step (\d+b?) exit (\d+)$/m.exec(step.out);
  assert.ok(
    match !== null,
    `${step.name} printed no \`step <n> exit <code>\` line:\n${step.out}`,
  );
  return Number(match[2]);
}

// ─── the fixture: a client repo mid-engagement ────────────────────────────────

const proposalDigest = (id: string, paths: readonly string[]): string =>
  `sha256:${createHash("sha256")
    .update(
      JSON.stringify({ halt_reason: "completed", proposal_id: id, paths }),
    )
    .digest("hex")}`;

function signedGrant(): string {
  const grant = {
    id: GRANT_ID,
    principal: "acme",
    agent: "builder",
    paths: ["src/"],
    tools: ["hexagen_propose_patch"],
    mode: "propose" as const,
    expires_at: EXPIRES,
  };
  return `${JSON.stringify(
    {
      ...grant,
      signature: signGrantPayload(canonicalGrantPayload(grant), KEY),
    },
    null,
    2,
  )}\n`;
}

function proposeLine(
  id: string,
  paths: readonly string[],
): Record<string, unknown> {
  return {
    grant_id: GRANT_ID,
    goal_id: SLICE_ID,
    tool_calls: [
      {
        name: "hexagen_propose_patch",
        args_digest: "sha256:aa",
        result_digest: proposalDigest(id, paths),
        time: CALL_TIME,
      },
    ],
    halt_reason: "completed",
    transaction_ids: [],
    started_at: CALL_TIME,
    ended_at: CALL_TIME,
  };
}

function proposalMeta(
  id: string,
  paths: readonly string[],
  seq: number,
): string {
  return `${JSON.stringify(
    {
      id,
      grantId: GRANT_ID,
      sliceId: SLICE_ID,
      tool: "hexagen_propose_patch",
      paths,
      traceSeq: seq,
      createdAt: CALL_TIME,
    },
    null,
    2,
  )}\n`;
}

let fix: ContractFixture;
/** The base commit every case starts from; the per-test hook restores it. */
let pristine: string;
/**
 * The commit before `.hexagen/` was staged: the base of the PR that first
 * commits the evidence, which is the bootstrap case.
 */
let treeOnly: string;

const git = (...args: string[]): string =>
  execFileSync(
    "git",
    ["-c", "user.email=t@example.test", "-c", "user.name=t", ...args],
    { cwd: fix.root, encoding: "utf8" },
  ).trim();

const abs = (rel: string): string => path.join(fix.root, rel);
const binDir = (): string => path.join(fix.root, "node_modules", ".bin");

async function put(rel: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
  await fs.writeFile(abs(rel), text, "utf8");
}

/**
 * Stage these paths and commit. Explicit paths only, and `add -f` past the
 * exclude file — which is exactly what `hexagen workbook export --stage` forces
 * past — and never `add -A`, which would pull the copied dist in through
 * `node_modules/`.
 */
function commit(message: string, paths: readonly string[] = []): string {
  if (paths.length > 0) git("add", "-f", "--", ...paths);
  git("commit", "-q", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD");
}

const lastLine = async (): Promise<{ seq: number; hash: string }> => {
  const raw = await fs.readFile(abs(TRACE), "utf8");
  const value = JSON.parse(raw.trimEnd().split("\n").pop() as string) as {
    seq: number;
  };
  return { seq: value.seq, hash: lineHash(value) };
};

/**
 * What `evidence pack` writes: the tip binds the head of the trace to the
 * engagement key, and only an anchored line can cover a change — so a fixture
 * that wants a change accounted for has to pack, not merely append.
 */
async function anchorHead(): Promise<void> {
  const { seq, hash } = await lastLine();
  await put(
    TIP,
    `${JSON.stringify({ seq, hash, hmac: signTip(seq, hash, KEY) }, null, 2)}\n`,
  );
}

/** Append a covering line and its proposal, anchor it, and commit them. */
async function propose(
  message: string,
  id: string,
  paths: readonly string[],
  changed: readonly string[],
): Promise<void> {
  await appendChainedLine(abs(TRACE), (next) => ({
    ...proposeLine(id, paths),
    ...next,
  }));
  const { seq } = await lastLine();
  await put(`.hexagen/proposals/${id}.json`, proposalMeta(id, paths, seq));
  await anchorHead();
  commit(message, [...changed, TRACE, `.hexagen/proposals/${id}.json`, TIP]);
}

const EMPTY_SECTION = { collected: true, items: [] };

/**
 * The sidecar, one file at a time.
 *
 * Written separately because two cases need a base commit that holds only part
 * of it — a half-staged base, and a base with the slice but no trace — and a
 * single "write it all" helper could not express either. `slice.repo.commit`
 * names the commit the engagement machine was on when `slice init` ran, which
 * is the commit before the sidecar is staged.
 */
async function writeSlice(): Promise<void> {
  await put(
    ".hexagen/slice.json",
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        id: SLICE_ID,
        repo: { commit: treeOnly },
        paths: ["src/"],
        excludes: [],
        createdBy: "t@example.test",
        createdAt: CALL_TIME,
      },
      null,
      2,
    )}\n`,
  );
}

async function writeContract(): Promise<void> {
  await put(
    ".hexagen/contract.json",
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        sliceId: SLICE_ID,
        rules: [
          {
            id: "no-ui-api",
            kind: "forbid",
            from: "src/ui/",
            to: "src/api/",
            severity: "error",
          },
        ],
        knownViolations: [],
      },
      null,
      2,
    )}\n`,
  );
}

async function writeObserved(): Promise<void> {
  await put(
    ".hexagen/observed.json",
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        repo: { commit: treeOnly },
        generatedAt: CALL_TIME,
        packages: EMPTY_SECTION,
        languages: EMPTY_SECTION,
        build: EMPTY_SECTION,
        generated: EMPTY_SECTION,
        dontTouch: EMPTY_SECTION,
        edges: { collected: true, unreadLanguages: [], items: [] },
        unresolved: EMPTY_SECTION,
        limits: { truncated: false, reasons: [] },
      },
      null,
      2,
    )}\n`,
  );
}

/** Grant, one chained trace line, its proposal, and the tip that anchors it. */
async function writeEvidence(): Promise<void> {
  await put(".hexagen/grants/grant-1.json", signedGrant());
  await appendChainedLine(abs(TRACE), (next) => ({
    ...proposeLine("p0", ["src/api/client.ts"]),
    ...next,
  }));
  await put(
    ".hexagen/proposals/p0.json",
    proposalMeta("p0", ["src/api/client.ts"], 0),
  );
  await anchorHead();
}

const SLICE_FILE = ".hexagen/slice.json";
const CONTRACT_FILE = ".hexagen/contract.json";
const OBSERVED_FILE = ".hexagen/observed.json";
const GRANT_FILE = ".hexagen/grants/grant-1.json";
const PROPOSAL_FILE = ".hexagen/proposals/p0.json";

/** The paths `hexagen workbook export --stage` puts in the index. */
const STAGED_SIDECAR = [
  SLICE_FILE,
  CONTRACT_FILE,
  OBSERVED_FILE,
  GRANT_FILE,
  TRACE,
  TIP,
  PROPOSAL_FILE,
];

beforeAll(async () => {
  await assertBuiltArtifactsPresent();
  fix = await createPublishedLayoutFixture("", "hexagen-gate-contract-", {
    clientRepo: true,
  });
  // The scripts call `hexagen` by name, the way npm puts it on a runner's PATH.
  await writeBinStub(binDir(), "hexagen", {
    sh: `#!/bin/sh\nexec "${process.execPath}" "${fix.cli}" "$@"\n`,
    cmd: `@echo off\r\n"${process.execPath}" "${fix.cli}" %*\r\n`,
  });
  git("init", "-q");
  // A client repo excludes `.hexagen/` through the exclude file, as every
  // writer of it does. Step 0 exists precisely because of this.
  await fs.writeFile(
    path.join(fix.root, ".git", "info", "exclude"),
    "# Everything a hexagen command wrote.\n.hexagen/\n",
    "utf8",
  );
  await put(
    "package.json",
    `${JSON.stringify({ name: "acme-client", private: true }, null, 2)}\n`,
  );
  await put("tsconfig.base.json", "{}\n");
  await put(".gitignore", "node_modules/\n");
  await put("README.md", "# acme-client\n");
  await put("src/api/client.ts", 'export const client = "api";\n');
  await put("src/ui/view.ts", 'export const view = "ui";\n');
  // One commit staging the client's tree, the way the engagement machine had it
  // before any kit command wrote to `.hexagen/`.
  commit("the engagement: the client's tree", [
    "package.json",
    "tsconfig.base.json",
    ".gitignore",
    "README.md",
    "src/api/client.ts",
    "src/ui/view.ts",
  ]);
  // `slice init` read HEAD here and wrote that commit once; the observed report
  // was read at the same commit. Step 1 rewrites the report at HEAD on every
  // run, so only step 0's list depends on these being committed.
  treeOnly = git("rev-parse", "HEAD");
  await writeSlice();
  await writeContract();
  await writeObserved();
  await writeEvidence();
  commit("the engagement: evidence staged", STAGED_SIDECAR);
  pristine = git("rev-parse", "HEAD");
}, 180_000);

beforeEach(async () => {
  // Only the git state a case changed. The copied dist is gitignored, so it is
  // never cleaned and never re-copied.
  git("reset", "--hard", "-q", pristine);
  git("clean", "-fdq");
  // `git clean` honours the exclude file, and the gate writes its bundle under
  // the excluded `.hexagen/`; `evidence pack` refuses an --out that already
  // exists, so it is removed by name.
  await fs.rm(abs(BUNDLE), { force: true });
});

afterAll(async () => {
  await cleanupFixture(fix.root);
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ─── the cases ────────────────────────────────────────────────────────────────

describe(
  "the brownfield CI gate (built dist, published layout, client repo)",
  { skip: SKIP_NON_POSIX },
  () => {
    it("case 1: a clean PR — every step exits 0 and the job exits 0", async () => {
      // Nothing under the slice changed, so `slice check` has no drift to
      // report, and nothing in it changed unaccounted, so `evidence verify`
      // has nothing to call unaccounted.
      await put(
        "README.md",
        "# acme-client\n\nA repo holding only `.hexagen/`.\n",
      );
      commit("docs: a note the slice does not cover", ["README.md"]);

      const run = await runGate({ base: pristine });

      assert.equal(run.jobExit, 0, dump(run));
      assert.equal(run.stoppedAt, undefined, dump(run));
      for (const name of STEPS_WITH_A_REPORTED_EXIT) {
        assert.equal(reportedExit(ran(run, name)), 0, dump(run));
      }
      assert.equal(ran(run, KEY_STEP).code, 0, dump(run));
      assert.equal(ran(run, FINGERPRINT).code, 0, dump(run));
      assert.match(ran(run, STEP_4B).out, /evidence verify ok/, dump(run));
    });

    it("case 2: an in-slice commit — step 2 reports 1 and the job still exits 0", async () => {
      // A change inside the slice, accounted for by an anchored trace line. So
      // `slice check` must report drift — and the job must still be green: a
      // gate that is red on every run is not a gate.
      await put(
        "src/api/client.ts",
        'export const client = "api";\nexport const retry = 2;\n',
      );
      await propose(
        "fix: retry the client twice",
        "p1",
        ["src/api/client.ts"],
        ["src/api/client.ts"],
      );

      const run = await runGate({ base: pristine });

      const step2 = ran(run, STEP_2);
      assert.equal(reportedExit(step2), 1, dump(run));
      assert.match(step2.out, /drift: changed since /, dump(run));
      // Exit 1 is logged as a notice and the step returns 0, so the fail-fast
      // chain carries on.
      assert.equal(step2.code, 0, dump(run));
      assert.equal(run.jobExit, 0, dump(run));
      assert.equal(reportedExit(ran(run, STEP_4B)), 0, dump(run));
      assert.match(
        ran(run, STEP_4B).out,
        /covered by a line appended after/,
        dump(run),
      );
    });

    it("case 3: nothing staged — step 0 exits 2, names the path, says it was never staged", async () => {
      // The files are on disk and were never staged: what a fresh clone of a
      // repo whose engagement machine wrote them looks like. `git show` cannot
      // tell this from "the commit that adds them", which is why step 0 exists.
      git("rm", "-q", "-r", "--cached", ".hexagen");
      commit("evidence unstaged from the tree");

      const run = await runGate({ base: pristine });

      assert.equal(run.jobExit, 2, dump(run));
      assert.equal(run.stoppedAt, STEP_0, dump(run));
      const step0 = ran(run, STEP_0);
      assert.equal(step0.code, 2, dump(run));
      assert.equal(reportedExit(step0), 2, dump(run));
      assert.match(
        step0.out,
        /\.hexagen\/slice\.json is not tracked/,
        dump(run),
      );
      assert.match(
        step0.out,
        /It was never staged — this is not a first commit/,
        dump(run),
      );
      assert.match(step0.out, /hexagen workbook export --stage/, dump(run));
      // Fail-closed: nothing ran past the precondition.
      skipped(run, STEP_1);
      skipped(run, STEP_3);
      skipped(run, STEP_4B);
    });

    it("case 5: a new forbidden crossing — step 3 exits 1 and the job stops there", async () => {
      await put(
        "src/ui/leak.ts",
        'import { client } from "../api/client";\nexport const leak = client;\n',
      );
      commit("feat: a ui file that reaches into the api", ["src/ui/leak.ts"]);

      const run = await runGate({ base: pristine });

      assert.equal(run.jobExit, 1, dump(run));
      assert.equal(run.stoppedAt, STEP_3, dump(run));
      const step3 = ran(run, STEP_3);
      assert.equal(step3.code, 1, dump(run));
      // The step's own line reads 1, and no step after it claimed a pass.
      assert.equal(reportedExit(step3), 1, dump(run));
      assert.match(
        step3.out,
        /violation: no-ui-api {2}src\/ui\/leak\.ts/,
        dump(run),
      );
      skipped(run, STEP_4);
      skipped(run, STEP_4B);
    });

    it("case 6: an edited trace — pack exits 1 and writes no bundle; verify exits 2", async () => {
      // An interior line rewritten after the fact: the chain no longer says what
      // it says, and the tip no longer anchors the line it names.
      const raw = await fs.readFile(abs(TRACE), "utf8");
      await fs.writeFile(
        abs(TRACE),
        raw.replace('"goal_id":"eng-1"', '"goal_id":"EDIT"'),
        "utf8",
      );
      commit("chore: edit the trace after the fact", [TRACE]);

      const run = await runGate({ base: pristine });

      assert.equal(run.jobExit, 1, dump(run));
      assert.equal(run.stoppedAt, STEP_4, dump(run));
      const step4 = ran(run, STEP_4);
      assert.equal(reportedExit(step4), 1, dump(run));
      assert.equal(step4.code, 1, dump(run));
      // "A bundle that exists is a bundle that passed", so a failed pack wrote
      // nothing and the job has no artefact to keep.
      assert.equal(await pathExists(abs(BUNDLE)), false, dump(run));

      // The job stopped at step 4, so step 4b is run on its own: evidence that
      // is not sound exits 2 before any coverage is judged.
      const verify = await runStep(STEP_4B, { base: pristine });
      assert.equal(verify.code, 2, dump(verify));
      assert.match(verify.out, /step 4b exit 2/, dump(verify));
      assert.match(verify.out, /the trace is not sound evidence/, dump(verify));
    });

    it("case 7: a run that starts at step 2 with a stale observed.json exits 2", async () => {
      // Step 1 rewrites `.hexagen/observed.json` at HEAD on every run, so a full
      // gate never reaches this state — cases 1 and 2 prove that, committing
      // past `observed.repo.commit` and getting 0 and 1, never 2, at step 2. What
      // this pins is the run that does NOT start at step 1: a stale report under
      // `--strict` is bad input, and the job must stop rather than judge a tree
      // the report never described.
      await put(
        "README.md",
        "# acme-client\n\nA repo holding only `.hexagen/`.\n",
      );
      commit("docs: a note the slice does not cover", ["README.md"]);

      const step2 = await runStep(STEP_2, { base: pristine });

      assert.equal(step2.code, 2, dump(step2));
      // Exit 2 is fatal for this step, so it leaves the chain: the reported code
      // is 2, not the 1 a drift report would print.
      assert.match(step2.out, /step 2 exit 2/, dump(step2));
      assert.match(
        step2.out,
        /observed\.json was read at \w+ but HEAD is \w+; re-run `hexagen observe` \(--strict\)/,
        dump(step2),
      );
    });

    it("case 8: no key — the job fails closed at the key step and both evidence commands exit 2", async () => {
      // A pull_request run from a fork receives no secrets.
      const run = await runGate({ base: pristine, secret: "" });

      assert.equal(run.jobExit, 2, dump(run));
      assert.equal(run.stoppedAt, KEY_STEP, dump(run));
      const key = ran(run, KEY_STEP);
      assert.equal(key.code, 2, dump(run));
      assert.match(key.out, /HEXAGEN_GRANT_KEY secret is empty/, dump(run));
      // A missing or weak key is a denial, not a skip: no evidence step ran.
      skipped(run, STEP_4);
      skipped(run, STEP_4B);
      assert.ok(!run.log.includes(KEY), "key material reached the log");

      // And each evidence command's own precondition, with no key to find.
      for (const name of [STEP_4, STEP_4B]) {
        const step = await runStep(name, { base: pristine, noKey: true });
        assert.equal(step.code, 2, dump(step));
        assert.match(step.out, /engagement key/, dump(step));
        assert.ok(!step.out.includes(KEY), "key material reached the log");
      }
      assert.equal(
        await pathExists(abs(BUNDLE)),
        false,
        "a pack with no key wrote a bundle",
      );
    });

    it("the fingerprint step fails without deciding the job (non-blocking by declaration)", async () => {
      // A grant file the report-only step reads and the gate steps never see:
      // steps 4 and 4b derive their grants from `git ls-files`, so an untracked
      // one is invisible to them, while the fingerprint step globs the workspace
      // and takes the first match. `grant show` cannot read it, so that step
      // exits 2 — and `continue-on-error: true` is what keeps that from deciding
      // the job. Non-blocking by declaration, not by swallowing.
      await put(".hexagen/grants/0-not-a-grant.json", "not json\n");
      try {
        await put(
          "README.md",
          "# acme-client\n\nA repo holding only `.hexagen/`.\n",
        );
        commit("docs: a note the slice does not cover", ["README.md"]);
        const run = await runGate({ base: pristine });

        const fingerprint = ran(run, FINGERPRINT);
        assert.equal(fingerprint.code, 2, dump(run));
        assert.match(fingerprint.out, /grants\/0-not-a-grant\.json/, dump(run));
        // Every gate step passed, and so does the job.
        assert.equal(run.jobExit, 0, dump(run));
        assert.equal(run.stoppedAt, undefined, dump(run));
        assert.equal(reportedExit(ran(run, STEP_4B)), 0, dump(run));
      } finally {
        await fs.rm(abs(".hexagen/grants/0-not-a-grant.json"), { force: true });
      }
    });

    it("case 9: the whole gate runs with no apps/web and no workbench package installed", async () => {
      await put(
        "README.md",
        "# acme-client\n\nA repo holding only `.hexagen/`.\n",
      );
      commit("docs: a note the slice does not cover", ["README.md"]);

      const run = await runGate({ base: pristine });

      assert.equal(run.jobExit, 0, dump(run));
      // A client repo holds `.hexagen/` and nothing this repo's tooling reads.
      assert.equal(await pathExists(path.join(fix.root, "apps")), false);
      assert.equal(await pathExists(path.join(fix.root, "packages")), false);
      assert.equal(
        await pathExists(path.join(fix.root, ".architecture", "manifest.yaml")),
        false,
      );
      // Installed: the published CLI, and the four packages tsup left external
      // (ADR-0068). No workspace package of any kind.
      const installed = (await fs.readdir(path.join(fix.root, "node_modules")))
        .filter((name) => !name.startsWith("."))
        .sort();
      assert.deepEqual(installed, [
        "@hexagen-monaco",
        ...[...EXTERNALS].sort(),
      ]);
      // And the run really used it: these steps ran the CLI through the shim.
      assert.match(
        ran(run, STEP_1).out,
        /will write: .*observed\.json/,
        dump(run),
      );
    });

    it("a half-staged base fails step 3 with exit 2, naming the file", async () => {
      // The FDE committed the slice and the contract lands in a later PR. One of
      // the two files the growth guard reads is at the base and the other is not,
      // which is neither a first commit (both absent) nor a base to compare
      // against (both present). Treating it as either would be a guess, and the
      // guess that lets an in-slice edit through is the one that matters.
      git("reset", "--hard", "-q", treeOnly);
      await writeSlice();
      const base = commit("the engagement: the slice, staged on its own", [
        SLICE_FILE,
      ]);
      await writeContract();
      await writeObserved();
      await writeEvidence();
      commit("the engagement: the contract and the evidence", [
        CONTRACT_FILE,
        OBSERVED_FILE,
        GRANT_FILE,
        TRACE,
        TIP,
        PROPOSAL_FILE,
      ]);
      await put(
        "src/api/client.ts",
        'export const client = "api";\nexport const retry = 2;\n',
      );
      commit("feat: retry the client twice", ["src/api/client.ts"]);

      const run = await runGate({ base });

      assert.equal(run.jobExit, 2, dump(run));
      assert.equal(run.stoppedAt, STEP_3, dump(run));
      const step3 = ran(run, STEP_3);
      assert.equal(step3.code, 2, dump(run));
      assert.match(step3.out, /step 3 exit 2/, dump(step3));
      assert.match(step3.out, /half-staged base/, dump(step3));
      assert.match(
        step3.out,
        new RegExp(`\\.hexagen/contract\\.json`),
        dump(step3),
      );
      assert.match(step3.out, /hexagen workbook export --stage/, dump(step3));
      // The repair cannot be "commit it on this branch": step 3 reads the BASE
      // commit, so a file staged here leaves the base partial and the re-run
      // fails identically. The message has to name the target branch.
      assert.match(step3.out, /Repair the TARGET branch/, dump(step3));
      assert.match(
        step3.out,
        /update this PR from the target branch/,
        dump(step3),
      );
      assert.ok(
        !/commit it on the branch/.test(step3.out),
        `the recovery still tells the author to fix the PR branch: ${step3.out}`,
      );
      // Neither the growth guard nor the coverage check was skipped over it.
      skipped(run, STEP_4);
      skipped(run, STEP_4B);
    });

    it("a base with the slice but no trace: step 4b runs and exits 2, it is not a bootstrap", async () => {
      // The sidecars landed earlier; the evidence lands in this PR. Skipping
      // step 4b here would be a second bootstrap, and it would skip the coverage
      // gate for the one PR that starts the evidence — which may carry an
      // in-slice edit. So it runs, and `evidence verify` refuses: a trace that
      // was never tracked at `<since>` cannot say which lines are new enough to
      // cover anything, and it will not guess.
      git("reset", "--hard", "-q", treeOnly);
      await writeSlice();
      await writeContract();
      await writeObserved();
      const base = commit("the engagement: sidecar staged, no evidence yet", [
        SLICE_FILE,
        CONTRACT_FILE,
        OBSERVED_FILE,
      ]);
      await writeEvidence();
      await put(
        "src/api/client.ts",
        'export const client = "api";\nexport const retry = 2;\n',
      );
      commit("feat: retry the client twice, with the evidence", [
        GRANT_FILE,
        TRACE,
        TIP,
        PROPOSAL_FILE,
        "src/api/client.ts",
      ]);

      const run = await runGate({ base });

      assert.equal(run.jobExit, 2, dump(run));
      assert.equal(run.stoppedAt, STEP_4B, dump(run));
      // The whole-trace gate still ran and passed; only the range check refuses.
      assert.equal(reportedExit(ran(run, STEP_4)), 0, dump(run));
      assert.equal(reportedExit(ran(run, STEP_3)), 0, dump(run));
      const step4b = ran(run, STEP_4B);
      assert.equal(step4b.code, 2, dump(run));
      assert.match(step4b.out, /step 4b exit 2/, dump(step4b));
      assert.match(step4b.out, /the trace is not tracked at/, dump(step4b));
      // The warning belongs to the step that can act on it: printed by the
      // resolve step it would also appear on the bootstrap, where step 4b never
      // runs, and after an earlier step failed — and a warning about a step that
      // did not run is noise.
      assert.ok(
        !MISSING_TRACE_WARNING.test(ran(run, RESOLVE).out),
        `the resolve step warns about a trace for a step that may never run:\n${dump(run)}`,
      );
      assert.match(step4b.out, MISSING_TRACE_WARNING, dump(step4b));
      assert.ok(
        step4b.out.search(MISSING_TRACE_WARNING) <
          step4b.out.indexOf("step 4b exit"),
        `the warning must come before the exit line it explains: ${dump(step4b)}`,
      );
      // The exit-2 annotation has to name the causes a reader cannot see: the
      // command's own reasons are in the log, not in a one-line annotation, and
      // "exit 2" alone does not say whether to fix the pin, the trace or the key.
      for (const cause of [
        /an unresolvable --since/,
        /a trace rewritten since the base/,
        /an empty diff/,
        /signed by another key/,
        /docs\/ci\/brownfield-gate-recipe\.md §Exit codes/,
      ]) {
        assert.match(step4b.out, cause, dump(step4b));
      }
    });

    it("the bootstrap case: with no contract at the base, step 3 runs a plain check", async () => {
      // The PR that FIRST stages `.hexagen/` has a base that predates it. Growth
      // has nothing to compare against, so step 3 judges violations only. And
      // `evidence verify` reads the slice from the `<since>` tree, so on that
      // one PR it has no governance to judge the range against and does not run.
      const run = await runGate({ base: treeOnly });

      assert.equal(run.jobExit, 0, dump(run));
      const step3 = ran(run, STEP_3);
      assert.equal(reportedExit(step3), 0, dump(run));
      assert.match(
        step3.out,
        /::notice::bootstrap: no contract at base/,
        dump(run),
      );
      assert.match(step3.out, /judges violations only/, dump(run));
      skipped(run, STEP_4B);
      assert.equal(reportedExit(ran(run, STEP_4)), 0, dump(run));
      // This base carries no trace either, and nothing warns about it: step 4b
      // is not running, so a warning would be about a step that did not run.
      assert.ok(
        !MISSING_TRACE_WARNING.test(ran(run, RESOLVE).out),
        `the bootstrap run warns about a trace for a step it skipped:\n${dump(run)}`,
      );

      // Step 4b's `if` skips it, and the reason is the command's own
      // precondition: it reads the slice from the `<since>` tree.
      const skippedVerify = await runStep(STEP_4B, { base: treeOnly });
      assert.equal(skippedVerify.code, null, dump(skippedVerify));
      const keyFile = path.join(
        await tempDir("hexagen-gate-key-"),
        "engagement.key",
      );
      await fs.writeFile(keyFile, `${KEY}\n`, { mode: 0o600 });
      const direct = await runHexagen(fix, [
        "evidence",
        "verify",
        "--since",
        treeOnly,
        "--grant",
        ".hexagen/grants/grant-1.json",
        "--key-file",
        keyFile,
      ]);
      assert.equal(direct.code, 2, describeResult(direct));
      assert.match(
        direct.stderr,
        new RegExp(`no slice at .hexagen/slice.json in ${treeOnly}`),
        describeResult(direct),
      );
    });

    it("the recipe's workflow block is the workflow file, byte for byte", async () => {
      // The recipe is what a client copies, and it holds a second copy of the
      // workflow. A copy that can drift is the failure this suite exists to
      // prevent, so the recipe's copy is pinned to the file, not trusted.
      const workflow = readFileSync(WORKFLOW_FILE, "utf8");
      const fenced = readFileSync(RECIPE_FILE, "utf8")
        .split("```yaml\n")[1]
        ?.split("\n```")[0];
      assert.ok(fenced !== undefined, `${RECIPE_FILE} has no yaml block`);
      assert.equal(
        `${fenced}\n`,
        workflow,
        "the recipe's workflow block is not docs/ci/brownfield-gate.yml; the two are meant to be byte-for-byte identical",
      );
    });
  },
);
