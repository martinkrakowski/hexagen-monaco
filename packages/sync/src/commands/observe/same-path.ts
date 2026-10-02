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
