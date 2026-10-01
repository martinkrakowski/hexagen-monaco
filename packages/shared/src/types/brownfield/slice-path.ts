/**
 * Path rules for a brownfield slice (plan 2026-10-01 §4.3).
 *
 * A slice entry is repo-relative and case-sensitive. An entry ending in `/` is
 * a directory prefix; any other entry is an exact file path. `.` and `..`
 * segments, empty segments, absolute paths (POSIX or drive-letter),
 * backslashes and NUL are refused. Nothing here touches the filesystem: a
 * path is judged by its text alone, never `stat`ed or resolved.
 */

export type SlicePathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The JSON Schema `pattern` for the same rules. Kept next to the function so
 * `docs/kernel/*.schema.json` and the zod schemas cannot drift (a test pins
 * both against the same samples).
 */
export const SLICE_PATH_PATTERN =
  "^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*[\\\\\\u0000]).+$";

export function normalizeSlicePath(input: string): SlicePathResult {
  if (input.length === 0) return { ok: false, reason: "empty path" };
  if (input.includes("\0")) return { ok: false, reason: "NUL in path" };
  if (input.includes("\\")) return { ok: false, reason: "backslash in path" };
  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) {
    return { ok: false, reason: "absolute path" };
  }
  const segments = input.split("/");
  // A single trailing slash marks a directory prefix; its empty tail is fine.
  const body = input.endsWith("/") ? segments.slice(0, -1) : segments;
  for (const segment of body) {
    if (segment === "") return { ok: false, reason: "empty path segment" };
    if (segment === "." || segment === "..") {
      return { ok: false, reason: `"${segment}" path segment` };
    }
  }
  return { ok: true, path: input };
}

function matches(entry: string, candidate: string): boolean {
  return entry.endsWith("/")
    ? candidate.startsWith(entry)
    : candidate === entry;
}

/** Shape the helper needs; the full `Slice` satisfies it. */
export interface SlicePaths {
  readonly paths: readonly string[];
  readonly excludes: readonly string[];
}

/**
 * True when `candidate` is inside the slice: valid, matched by `paths`, and not
 * matched by `excludes`. Everything else is denied, including any candidate
 * that fails the path rules (checked before matching).
 */
export function isPathInSlice(slice: SlicePaths, candidate: string): boolean {
  if (!normalizeSlicePath(candidate).ok) return false;
  if (slice.excludes.some((e) => matches(e, candidate))) return false;
  return slice.paths.some((p) => matches(p, candidate));
}
