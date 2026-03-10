export function ok<T>(value: T): Result<T, unknown> {
  return { success: true, value };
}

/**
 * Creates a failing Result.
 *
 * @param error - The error payload (any type, defaults to `unknown`).
 */
export function err<E = unknown>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Extracts the value from a successful Result or throws the error.
 *
 * @param result - The Result to unwrap.
 * @throws The error payload if the Result is a failure.
 */
export function unwrap<T, E = unknown>(result: Result<T, E>): T {
  if (result.success) {
    return result.value;
  }
  // Throw the error to surface failures in calling code.
  throw result.error;
}
