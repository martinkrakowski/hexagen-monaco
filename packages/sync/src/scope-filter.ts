/**
 * Scope filtering for `hexagen sync --only <pattern…>`.
 *
 * Conservative "direct targets only" semantics — a scope pattern limits which
 * workspace-relative paths the engine is allowed to write, with **no dependency
 * fan-out**. Regenerating one package does not pull in the packages that
 * reference it; for cross-package changes, run a full sync. This keeps `--only`
 * predictable: what you name is exactly what can be written.
 *
 * Pattern forms (a path is in scope if it matches ANY pattern):
 *
 *  - **Plain path / directory prefix** (no glob metacharacters): matches the
 *    path itself and everything beneath it. `packages/shared` matches
 *    `packages/shared` and `packages/shared/src/index.ts`.
 *  - **Glob** (contains `*` or `?`): matched against the FULL relative path,
 *    anchored. `*` matches any run of non-separator characters, `**` matches
 *    any run including the `/` separator, and `?` matches a single
 *    non-separator character. A single `*` therefore stays within one path
 *    segment (so it matches a package's own `tsconfig.json` but not one nested
 *    under `src`), while a double-star reaches any depth (e.g. an `index.ts`
 *    anywhere beneath a package). See the unit tests for concrete cases.
 *
 * Intentionally dependency-free (no minimatch/picomatch) — the `sync` package
 * keeps its runtime surface lean, and these semantics are a deliberately small
 * subset rather than full POSIX globbing.
 */

const GLOB_META = /[*?]/;

/**
 * Normalise a path or pattern for comparison: forward slashes, no leading
 * `./` or `/`, no trailing slash. (`--only packages/shared/` and
 * `packages/shared` are equivalent.)
 */
function normalize(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "");
}

/**
 * Translate the supported glob subset into an anchored RegExp. `**` must be
 * handled before `*` so it maps to the slash-crossing form.
 */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"; // ** — crosses directory separators
        i++;
      } else {
        re += "[^/]*"; // * — within a single path segment
      }
    } else if (c === "?") {
      re += "[^/]"; // single non-separator character
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += `\\${c}`; // escape regex metacharacters that are literal in globs
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * True when `relativePath` falls within at least one of the `--only` scope
 * patterns. An empty / undefined pattern list means "no scope filter" — callers
 * should not invoke this when the user passed no `--only`, but it returns
 * `false` for an empty list so a misuse fails closed rather than writing
 * everything.
 */
export function matchesScope(
  relativePath: string,
  patterns: readonly string[],
): boolean {
  const rel = normalize(relativePath);
  return patterns.some((raw) => {
    const pat = normalize(raw);
    if (pat === "") return false;
    if (!GLOB_META.test(pat)) {
      // Plain path: exact file or directory-prefix match.
      return rel === pat || rel.startsWith(`${pat}/`);
    }
    return globToRegExp(pat).test(rel);
  });
}
