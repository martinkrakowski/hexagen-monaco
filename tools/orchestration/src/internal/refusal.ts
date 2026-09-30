import { CONFIG_RELATIVE_PATH, type ConfigProblem } from "./config.js";

/**
 * The refuse-or-report contract for a `loadConfigFor` result.
 *
 * `loadConfigFor` always hands back a `config`, but when the overlay file is
 * PRESENT and has problems, a field that failed validation holds its default and
 * nothing about the result says which fields those are. A bin that ACTS on it
 * (writes, verifies, scaffolds) would be acting on values nobody wrote.
 *
 * So the rule, for every bin:
 * - a bin that acts on the config MUST refuse when `present && problems.length
 *   > 0`: exit 2, print every problem, write nothing. This function builds the
 *   text; the bin prints it and exits.
 * - only a diagnostic bin (`doctor`) prints the problems and keeps going,
 *   because reporting them is its whole job.
 * - an ABSENT file is not a refusal: it keeps every default.
 */
export function configRefusal(
  tool: string,
  action: string,
  loaded: {
    readonly present: boolean;
    readonly problems: readonly ConfigProblem[];
  },
): string[] | undefined {
  if (!loaded.present || loaded.problems.length === 0) return undefined;
  return [
    `${tool}: refusing to ${action}: ${CONFIG_RELATIVE_PATH} has ` +
      `${loaded.problems.length} problem(s), so its settings cannot be trusted:`,
    ...loaded.problems.map((problem) => `  ${problem.at} ${problem.message}`),
    "Fix the file (run `hexagen-orchestration-doctor`), then retry.",
  ];
}
