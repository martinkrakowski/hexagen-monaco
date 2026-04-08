// packages/sync/src/domain/result.ts
// Result<T, E> is canonical in @hexagen/shared. Re-exported here so that
// internal sync modules and the public @hexagen/sync barrel both resolve to
// the same type without an extra cross-package reference at every call site.
//
// ok/err keep E = Error as the default (vs shared's E = unknown) to preserve
// the type signatures of all existing sync ports and adapters without churn.
export type { Result } from "@hexagen/shared";

export function ok<T>(value: T): import("@hexagen/shared").Result<T, Error> {
  return { success: true, value };
}

export function err<E = Error>(
  error: E,
): import("@hexagen/shared").Result<never, E> {
  return { success: false, error };
}
