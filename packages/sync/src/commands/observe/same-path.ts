/**
 * Compare two already-resolved filesystem paths as text. Git prints forward
 * slashes even on Windows, and a temp root can differ from it by separator,
 * case (win32 is case-insensitive) or a trailing slash. Callers resolve both
 * sides with `fs.realpath.native` first, which also expands 8.3 short names.
 * Pure on purpose so it can be tested for every platform on any OS.
 */
function canonical(p: string, platform: string): string {
  let s = p.replace(/\\/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return platform === "win32" ? s.toLowerCase() : s;
}

export function samePath(
  a: string,
  b: string,
  platform: string = process.platform,
): boolean {
  return canonical(a, platform) === canonical(b, platform);
}

/**
 * True when `child` is `parent` itself or lies beneath it, judged on the same
 * canonical text as `samePath` (separators, case on win32, trailing slashes).
 * Both inputs must already be resolved with `fs.realpath.native`. Pure, so a
 * Windows decision can be tested on any OS.
 */
export function isSameOrInside(
  parent: string,
  child: string,
  platform: string = process.platform,
): boolean {
  const p = canonical(parent, platform);
  const c = canonical(child, platform);
  return c === p || c.startsWith(p.endsWith("/") ? p : `${p}/`);
}
