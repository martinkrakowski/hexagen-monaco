/**
 * Result<T, E> — an explicit success-or-failure value for *expected* failures.
 *
 * Return a Result from functions that fail in predictable ways (a lookup miss, a
 * validation error, a third-party call). Reserve `throw` for *unexpected*
 * failures — programming errors and missing configuration — that should crash
 * loudly rather than be handled inline.
 */
export type Result<T, E extends Error = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { success: true, value };
}

export function err<E extends Error>(error: E): Result<never, E> {
  return { success: false, error };
}

export function isOk<T, E extends Error>(
  result: Result<T, E>,
): result is { success: true; value: T } {
  return result.success;
}

export function isErr<T, E extends Error>(
  result: Result<T, E>,
): result is { success: false; error: E } {
  return !result.success;
}

/** Unwrap a success value, or throw the error. Use only at boundaries where a
 *  failure is genuinely unrecoverable. */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (result.success) return result.value;
  throw result.error;
}
