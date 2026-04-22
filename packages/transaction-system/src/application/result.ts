/**
 * Result type for use cases that can fail.
 * Follows the explicit error handling invariant — never return null/false/default from catch blocks.
 */
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };
