import type { Result } from "./result.js";

export function ok<T>(value: T): Result<T, unknown> {
  return { success: true, value };
}

export function err<E = unknown>(error: E): Result<never, E> {
  return { success: false, error };
}

export function unwrap<T, E = unknown>(result: Result<T, E>): T {
  if (result.success) {
    return result.value;
  }
  throw result.error;
}
