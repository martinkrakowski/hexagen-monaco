import type { AnswerMap, ManifestOutput, OutputCondition } from "./question.js";

/** The destination path of an output, whether or not it is gated. */
export function outputPath(output: ManifestOutput): string {
  return typeof output === "string" ? output : output.path;
}

/**
 * Whether a `{ answer, equals?, includes? }` condition is satisfied by the
 * given answers map. Used by gated outputs.
 *
 * - `includes` tests multiselect array membership.
 * - `equals` is an exact boolean/string match.
 * - A bare `{ answer }` is satisfied by any truthy value (boolean true,
 *   non-empty array, non-empty string).
 *
 * A missing/corrupt answers map yields `false` for any non-trivial condition,
 * which is the conservative default: gates don't fire without evidence.
 */
export function matchesCondition(
  when: OutputCondition,
  answers: AnswerMap | null | undefined,
): boolean {
  const value = answers?.[when.answer];
  const { equals, includes } = when;

  if (includes !== undefined) {
    return Array.isArray(value) && value.includes(includes);
  }
  if (equals !== undefined) {
    return value === equals;
  }
  return (
    value === true ||
    (Array.isArray(value) && value.length > 0) ||
    (typeof value === "string" && value !== "")
  );
}

/**
 * Whether an output should be emitted given the current answers.
 * Plain-string outputs are always enabled.
 */
export function isOutputEnabled(
  output: ManifestOutput,
  answers: AnswerMap | null | undefined,
): boolean {
  if (typeof output === "string") return true;
  return matchesCondition(output.when, answers);
}
