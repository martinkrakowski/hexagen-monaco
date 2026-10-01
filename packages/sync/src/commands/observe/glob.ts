/**
 * A small glob-to-RegExp translator for `hexagen observe`.
 *
 * Supports `*` (within a segment), `**` (across segments), `?`, `[...]`
 * classes, `{a,b}` alternation and backslash escapes. Everything else is
 * matched literally. Deliberately not `detectWorkspaces`, which throws on
 * anything but a trailing `/*`.
 *
 * Patterns are matched against repo-relative POSIX paths with no leading or
 * trailing slash.
 */

function escapeRegex(ch: string): string {
  return /[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch;
}

/** Translate a glob body to a regex source (no anchors). */
export function globToRegexSource(glob: string, braces = true): string {
  let out = "";
  let braceDepth = 0;
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i] as string;
    if (ch === "/" && glob.slice(i) === "/**") {
      out += "/.*"; // trailing `/**`: anything inside
      break;
    } else if (ch === "\\" && i + 1 < glob.length) {
      out += escapeRegex(glob[i + 1] as string);
      i += 2;
    } else if (ch === "*") {
      if (glob[i + 1] === "*") {
        const atSegmentStart = i === 0 || glob[i - 1] === "/";
        if (atSegmentStart && glob[i + 2] === "/") {
          out += "(?:.*/)?"; // `**/` also matches zero segments
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else if (ch === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end === -1) {
        out += "\\[";
        i += 1;
      } else {
        let body = glob.slice(i + 1, end);
        if (body.startsWith("!")) body = "^" + body.slice(1);
        out += `[${body.replace(/\\/g, "\\\\")}]`;
        i = end + 1;
      }
    } else if (braces && ch === "{" && glob.indexOf("}", i) !== -1) {
      braceDepth += 1;
      out += "(?:";
      i += 1;
    } else if (braces && ch === "}" && braceDepth > 0) {
      braceDepth -= 1;
      out += ")";
      i += 1;
    } else if (braces && ch === "," && braceDepth > 0) {
      out += "|";
      i += 1;
    } else {
      out += escapeRegex(ch);
      i += 1;
    }
  }
  while (braceDepth-- > 0) out += ")";
  return out;
}

/** Anchored regex for a whole-path glob match. */
export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${globToRegexSource(glob)}$`);
}
