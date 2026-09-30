/**
 * One rule from a lane's brief, and the test that pins it.
 *
 * A two-stage lane hands its implementation to a different seat, and the
 * implementation comes out exactly as complete as the tests it is given. A
 * stage-1 author that misses a rule produces a lane that ships with that rule
 * unimplemented and **100 % coverage**, because missing behaviour leaves no
 * uncovered code. This map is what makes that omission visible before stage 2
 * starts.
 */
export interface RuleBinding {
  /** Short id for the rule, as the brief names it. */
  readonly id: string;
  /** The rule in the brief's own words, so a reader can check the test matches it. */
  readonly statement: string;
  /** The exact `test()` / `it()` name that pins this rule. */
  readonly test: string;
}

export interface Handoff {
  readonly version: 1;
  readonly lane: string;
  /** Test files the bindings refer to, as paths from the repository root. */
  readonly files: readonly string[];
  readonly rules: readonly RuleBinding[];
}

/**
 * `missing`  — the rule's test name is not in any of the files.
 * `passing`  — the test exists but already passes, so it pins nothing yet.
 * `red`      — the test exists and fails: ready for stage 2.
 */
export type BindingStatus = "missing" | "passing" | "red";

export interface BindingResult {
  readonly rule: RuleBinding;
  readonly status: BindingStatus;
}

export interface HandoffReport {
  readonly lane: string;
  readonly bindings: readonly BindingResult[];
  /** Tests present in the files that no rule claims. Reported, never fatal. */
  readonly unclaimed: readonly string[];
}

export interface HandoffDeps {
  readonly readFile: (path: string) => Promise<string>;
  /** Runs the suite and returns the names of tests that failed. */
  readonly failingTests: (
    files: readonly string[],
  ) => Promise<readonly string[]>;
}
