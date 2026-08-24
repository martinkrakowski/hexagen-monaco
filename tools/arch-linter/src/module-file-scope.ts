/**
 * Does a ts-morph source-file path live under a module's directory?
 *
 * The two sides speak different path conventions and must be reconciled
 * before they are compared:
 *
 * - ts-morph (`SourceFile.getFilePath()`) returns TypeScript's own form —
 *   **forward slashes on every platform**, including Windows.
 * - A module root comes from `path.join` / `path.resolve` — **native**
 *   separators, so backslashes on Windows.
 *
 * Comparing them directly matched nothing on Windows, so every module scanned
 * zero source files and `hexagen-lint` exited 2 with "NOTHING WAS CHECKED".
 * The shipped linter could not analyse a single file on Windows; the
 * fail-closed vacuity guard is the only reason it said so instead of
 * reporting a clean tree. Same class as #466, recurring at a call site that
 * the earlier fix did not reach — `resolve-scope.ts` and
 * `layer-purity-violation.ts` already normalise, `cli.ts` did not.
 *
 * The trailing-separator boundary is load-bearing: without it `ui` matches
 * `ui-projection-compiler`.
 */
export function isFileUnderModule(
  tsMorphFilePath: string,
  moduleNativePath: string,
): boolean {
  const modulePosix = moduleNativePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const filePosix = tsMorphFilePath.replace(/\\/g, "/");
  return filePosix === modulePosix || filePosix.startsWith(modulePosix + "/");
}
