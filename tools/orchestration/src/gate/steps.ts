import type { Config } from "../internal/config.js";

/**
 * The gate's step list, resolved from the overlay.
 *
 * Everything the loop runs, and everything the loop is told about the machine-
 * wide lock, is decided HERE, in TypeScript, from the project's own
 * configuration — never from a list baked into a script. That is the whole
 * point of the port: one source of truth for the gate's steps, so a gate and
 * the pipeline that has to agree with it read the same file.
 *
 * Three decisions live here:
 *
 * - the `mutate` omission. Mutating steps run only when the overlay says so, so
 *   a project that has not opted in gets a gate that cannot write to its tree.
 * - which steps hold the lock, read from `locked: true` and NEVER from a name.
 *   A name-keyed list is a list that goes stale the moment somebody renames the
 *   step that actually needs the mutual exclusion.
 * - which steps may skip, read from `optional: true`.
 */

/** The bin that verifies the generated manifests. `mutate: false` omits it. */
const VERIFY_MANIFESTS_BIN = "hexagen-orchestration-verify-manifests";

/** The prefix of every mutating bin. `mutate: false` omits all of them. */
const MUTATE_BIN_PREFIX = "hexagen-orchestration-mutate";

/** One step, as the loop will be told about it. */
export interface GateStepPlan {
  readonly name: string;
  readonly command: string;
  /** Runs under the machine-wide gate lock. Only `locked: true` sets this. */
  readonly locked: boolean;
  /** May be skipped when its script is absent from `package.json`. */
  readonly optional: boolean;
}

/**
 * The program a command line invokes: its first word, with an
 * `npx --no-install` prefix stepped over. The gate's own steps call this repo's
 * bins that way, because a `yarn` alias is a fact about one repository's root
 * `package.json` and does not travel with a published package.
 */
export function programWord(command: string): string | undefined {
  const words = command
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  let at = 0;
  if (words[0] === "npx") {
    at = 1;
    if (words[at] === "--no-install") at += 1;
  }
  return words[at];
}

/**
 * Whether a step is one a project only opts into with `mutate: true`.
 *
 * Name-agnostic on purpose, and anchored on the BIN rather than on a step name:
 * the gate must not run a tool that rewrites the tree for a project that has
 * not asked for it, whatever that tool's step happens to be called.
 */
export function isMutateGated(command: string): boolean {
  const word = programWord(command);
  if (word === undefined) return false;
  return word === VERIFY_MANIFESTS_BIN || word.startsWith(MUTATE_BIN_PREFIX);
}

/** The overlay's step list, with the `mutate` omission applied. Order is kept. */
export function resolveGateSteps(config: Config): readonly GateStepPlan[] {
  const kept = config.mutate
    ? config.gateSteps
    : config.gateSteps.filter((step) => !isMutateGated(step.command));
  return kept.map((step) => ({
    name: step.name,
    command: step.command,
    locked: step.locked === true,
    optional: step.optional === true,
  }));
}

/**
 * The steps `--print-steps` prints, one `name<TAB>command` line each. No
 * trailing newline of its own: the caller joins, and the caller owns the single
 * trailing newline the contract asks for.
 */
export function renderSteps(steps: readonly GateStepPlan[]): string {
  return steps.map((step) => `${step.name}\t${step.command}`).join("\n");
}

/**
 * The locked step names for `HEXAGEN_GATE_LOCKED`, space-separated with a
 * leading and a trailing space. The spaces are part of the contract: the loop
 * matches by plain substring, and a single space keeps a name that is a prefix
 * of another from matching both.
 */
export function lockedNameList(steps: readonly GateStepPlan[]): string {
  const names = steps.filter((step) => step.locked).map((step) => step.name);
  return names.length === 0 ? " " : ` ${names.join(" ")} `;
}

/**
 * The `package.json` script a step names, when its command is exactly
 * `yarn <script>` — two words, one of them `yarn`, one of them a script name.
 *
 * Anything else (`npx --no-install <bin>`, a compound command, a bare binary)
 * names no script and so can never be missing one: the skip rule is about a
 * script the project declared and then did not, not about a program the gate
 * does not know how to check for.
 */
export function scriptNameOf(command: string): string | undefined {
  const words = command
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length !== 2 || words[0] !== "yarn") return undefined;
  return words[1];
}

/** The reason a step is skipped when the script it names is absent. */
export function skipReason(script: string): string {
  return `no ${script} script in package.json`;
}

/** One step the bin has decided to skip, with the reason the loop will print. */
export interface GateSkip {
  readonly name: string;
  readonly reason: string;
}

/** What a step name may look like: it is matched whole, by name, in the loop. */
const STEP_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

/**
 * The first reason the step list cannot be handed to the loop, or undefined.
 *
 * The loop's protocol is text: `name<TAB>command` lines, a space-delimited list
 * of locked names and a `name<TAB>reason` skip list. A name with a space, a
 * name shared by two steps, or a command holding a line break or a tab would
 * each let one step's lock or skip land on another, or forge a step line, so
 * they are refused before anything runs.
 */
export function stepListProblem(
  steps: readonly GateStepPlan[],
): string | undefined {
  const seen = new Set<string>();
  for (const step of steps) {
    if (!STEP_NAME.test(step.name)) {
      return `step name ${JSON.stringify(step.name)} is not allowed — it must match ${STEP_NAME.source}`;
    }
    if (seen.has(step.name)) {
      return `step '${step.name}' appears more than once — step names must be unique`;
    }
    seen.add(step.name);
    if (/[\n\r\t]/.test(step.command)) {
      return `step '${step.name}' has a command containing a newline, carriage return or tab — a command must be one line without tabs`;
    }
  }
  return undefined;
}
