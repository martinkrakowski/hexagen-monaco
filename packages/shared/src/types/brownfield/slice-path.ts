/**
 * Path rules for a brownfield slice (plan 2026-10-01 §4.3).
 *
 * A slice entry is repo-relative and case-sensitive. An entry ending in `/` is
 * a directory prefix; any other entry is an exact file path. `.` and `..`
 * segments, empty segments, absolute paths (POSIX or drive-letter),
 * backslashes and control characters (U+0000-U+001F, U+007F, U+2028,
 * U+2029) are refused. Nothing here touches the filesystem: a
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
  "^(?!/)(?![A-Za-z]:)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)(?!.*[\\\\\\u0000-\\u001f\\u007f\\u2028\\u2029]).+$";

/** U+0000-U+001F, U+007F, U+2028 and U+2029. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

export function normalizeSlicePath(input: string): SlicePathResult {
  if (input.length === 0) return { ok: false, reason: "empty path" };
  if (hasControlCharacter(input)) {
    return { ok: false, reason: "control character in path" };
  }
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
 * matched by `excludes`. A candidate that names a directory must end in `/`; a
 * bare directory name is judged as a file path (so `src/gen` is not caught by
 * an `excludes` entry of `src/gen/`). Everything else is denied, including any candidate
 * that fails the path rules (checked before matching).
 */
export function isPathInSlice(slice: SlicePaths, candidate: string): boolean {
  if (!normalizeSlicePath(candidate).ok) return false;
  if (slice.excludes.some((e) => matches(e, candidate))) return false;
  return slice.paths.some((p) => matches(p, candidate));
}
