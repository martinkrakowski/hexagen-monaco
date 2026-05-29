import type { AnswerMap, ManifestOutput } from "./question.js";

/** The destination path of an output, whether or not it is gated. */
export function outputPath(output: ManifestOutput): string {
  return typeof output === "string" ? output : output.path;
}

/**
 * Whether an output should be emitted given the current answers.
 *
 * Plain-string outputs are always enabled. Gated outputs evaluate their `when`
 * condition: `includes` tests multiselect membership, `equals` is an exact
 * boolean/select match, and a bare `{ answer }` is satisfied by a truthy value
 * (boolean true, a non-empty array, or a non-empty string).
 */
export function isOutputEnabled(
  output: ManifestOutput,
  answers: AnswerMap | null | undefined,
): boolean {
  if (typeof output === "string") return true;

  // Tolerate a missing/corrupt answers map (e.g. config loaded from disk without
  // validation) — optional chaining yields undefined instead of throwing.
  const value = answers?.[output.when.answer];
  const { equals, includes } = output.when;

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
