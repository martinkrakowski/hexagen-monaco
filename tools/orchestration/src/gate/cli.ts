import type { Config, ConfigProblem } from "../internal/config.js";
import { configRefusal } from "../internal/refusal.js";
import {
  lockedNameList,
  renderSteps,
  resolveGateSteps,
  scriptNameOf,
  skipReason,
  type GateSkip,
  type GateStepPlan,
} from "./steps.js";

/**
 * `hexagen-orchestration-gate` — the front end.
 *
 * It decides, and it hands the decisions to the run loop:
 *
 *   1. read the overlay. A file that is PRESENT and has problems is a refusal:
 *      print every problem, exit 2, run nothing. `loadConfigFor` hands back
 *      defaults for such a file, so without the refusal a gate would run a step
 *      list nobody wrote and report green over it.
 *   2. resolve the step list, with the `mutate` omission applied. An empty
 *      result is a refusal naming `gateSteps`, not an empty green run.
 *   3. `--print-steps` prints the resolved list and exits 0. It never reads
 *      `package.json` and never spawns anything: the flag exists so a caller can
 *      SEE what the gate would run.
 *   4. decide skips, from the root `package.json`.
 *   5. spawn the loop with the step list, the locked names and the skip reasons
 *      in its environment, and adopt its exit code.
 *
 * The decisions live here rather than in the bin so they can be unit-tested
 * against a config passed in, and so the bin has nothing left to get wrong
 * beyond supplying the real filesystem and the real process.
 */

/** The gate's own refusal code, shared with the loop's argument validation. */
export const EXIT_UNUSABLE = 2;

/** Prints the resolved step list and exits without running anything. */
export const PRINT_STEPS_FLAG = "--print-steps";

/** What `loadConfigFor` returns, as this CLI needs it. */
export interface LoadedGateProject {
  readonly config: Config;
  /** Whether the overlay file exists at all. */
  readonly present: boolean;
  readonly problems: readonly ConfigProblem[];
}

/** Everything the CLI hands to the run loop. */
export interface GateSpawn {
  /** Absolute path of `bin/gate-run.sh`. */
  readonly script: string;
  /** The caller's argv, minus `--print-steps`. */
  readonly argv: readonly string[];
  /** The project root, so the loop's steps run where the project is. */
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

/** The world this CLI touches, injected so a test can watch it. */
export interface GateCliDeps {
  /**
   * The environment the loop inherits. The real bin passes `process.env`: the
   * loop's steps need `HOME`, `CI`, whatever the project's tools read, and the
   * three `HEXAGEN_GATE_*` variables are layered ON TOP of this, not instead of
   * it.
   */
  readonly env: NodeJS.ProcessEnv;
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  /**
   * The root `package.json`'s `scripts` map, or `undefined` when there is no
   * readable `package.json`. `undefined` and an empty map behave identically:
   * every `yarn <script>` step names a script that is not there.
   */
  readonly scripts: Readonly<Record<string, unknown>> | undefined;
  readonly runLoop: (spawn: GateSpawn) => number;
}

/**
 * The skip decisions, or the step that must not be skipped.
 *
 * A step whose command is exactly `yarn <script>` and whose script the
 * `package.json` does not have cannot run. Only a step marked `optional: true`
 * may live with that, and it is then PRINTED and COUNTED as skipped: a gate that
 * passes in silence over a check it did not run is the one failure mode a gate
 * exists to prevent. A step that is not optional is a refusal, before step one.
 */
export function planSkips(
  steps: readonly GateStepPlan[],
  scripts: Readonly<Record<string, unknown>> | undefined,
): { readonly skips: readonly GateSkip[] } | { readonly refused: string } {
  const present = (script: string): boolean =>
    scripts !== undefined &&
    Object.prototype.hasOwnProperty.call(scripts, script);
  const skips: GateSkip[] = [];
  for (const step of steps) {
    const script = scriptNameOf(step.command);
    if (script === undefined || present(script)) continue;
    if (!step.optional) {
      return {
        refused:
          `gate: refusing to run — step '${step.name}' runs 'yarn ${script}' and ` +
          `package.json has no '${script}' script. Mark the step 'optional: true' ` +
          `if its absence is expected, or fix the step.`,
      };
    }
    skips.push({ name: step.name, reason: skipReason(script) });
  }
  return { skips };
}

/** The environment the loop runs with: the steps, the lock's names, the skips. */
export function loopEnv(
  base: NodeJS.ProcessEnv,
  steps: readonly GateStepPlan[],
  skips: readonly GateSkip[],
): NodeJS.ProcessEnv {
  return {
    ...base,
    HEXAGEN_GATE_STEPS: renderSteps(steps),
    HEXAGEN_GATE_LOCKED: lockedNameList(steps),
    // Always set, `""` when there are none. The loop reads this variable, and a
    // value the CALLER exported would otherwise survive the spread above and
    // make the loop skip a step the bin decided to run.
    HEXAGEN_GATE_SKIP: skips
      .map((skip) => `${skip.name}\t${skip.reason}`)
      .join("\n"),
  };
}

/** The caller's argv with `--print-steps` taken out of it, wherever it appears. */
export function argvForLoop(argv: readonly string[]): readonly string[] {
  return argv.filter((arg) => arg !== PRINT_STEPS_FLAG);
}

/**
 * The whole gate, as a function of what it was given. Returns the exit code.
 *
 * The order of the decisions is the contract: `--print-steps` answers before
 * `package.json` is ever read, so printing the step list can never fail because
 * of a missing script, and a step whose command would create a file creates
 * nothing.
 */
export function runGate(
  argv: readonly string[],
  loaded: LoadedGateProject,
  deps: GateCliDeps,
  loopScript: string,
  root: string,
): number {
  const refusal = configRefusal("gate", "run", loaded);
  if (refusal !== undefined) {
    for (const line of refusal) deps.logError(line);
    return EXIT_UNUSABLE;
  }

  const steps = resolveGateSteps(loaded.config);
  if (steps.length === 0) {
    deps.logError(
      "gate: refusing to run — gateSteps resolved to no steps" +
        (loaded.config.mutate
          ? "."
          : ", and the ones it lists are mutate-only steps that `mutate: false` omits;"),
    );
    return EXIT_UNUSABLE;
  }

  if (argv.includes(PRINT_STEPS_FLAG)) {
    // One line per step, in config order, a final newline, and nothing else.
    deps.log(`${renderSteps(steps)}\n`);
    return 0;
  }

  const planned = planSkips(steps, deps.scripts);
  if ("refused" in planned) {
    deps.logError(planned.refused);
    return EXIT_UNUSABLE;
  }

  return deps.runLoop({
    script: loopScript,
    argv: argvForLoop(argv),
    cwd: root,
    env: loopEnv(deps.env, steps, planned.skips),
  });
}
