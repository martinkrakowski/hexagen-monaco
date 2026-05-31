// A placeholder is a *bare* `{identifier}`. Anything `$`-prefixed is code, not a
// placeholder, and must pass through untouched:
//   - `${{ ... }}` — GitHub Actions expression (matched first, whole, so its
//     inner `{{`/`}}` never reach the escape rules; non-greedy body so adjacent
//     `${{ a }}${{ b }}` don't merge).
//   - `${ ... }`   — JS template literal / shell expansion: a `{ident}` whose
//     preceding character is `$` is part of a `${...}` expression and is left
//     verbatim, so e.g. `${res.status}` or `${COOKIE_NAME}` aren't rewritten and
//     don't warn.
//
// The `${...}` case is detected via the replace callback's `offset` argument
// rather than a regex lookbehind: a lookbehind literal throws a parse-time
// SyntaxError in some JS runtimes (e.g. Safari < 16.4), and this module is
// bundled into the browser through `@hexagen/shared` (listed in the web app's
// `transpilePackages`).
const TOKEN_RE = /\$\{\{[\s\S]*?\}\}|\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

export interface InterpolationResult {
  output: string;
  warnings: string[];
}

/**
 * Replace `{variable}` placeholders in a template string with values from `vars`.
 *
 * - Missing or null/undefined keys leave the placeholder verbatim and add the
 *   identifier to `warnings`.
 * - `{{` → literal `{`, `}}` → literal `}` (escape sequences).
 * - `$`-prefixed expressions pass through untouched — GitHub Actions
 *   `${{ ... }}` and JS/shell `${ ... }` — so workflow templates and emitted
 *   TypeScript can use them freely. Only a *bare* `{var}` is a placeholder.
 * - A single pass only — values containing braces are not re-interpolated.
 */
export function interpolate(
  template: string,
  vars: Record<string, unknown>,
): InterpolationResult {
  const warnings: string[] = [];

  const output = template.replace(
    TOKEN_RE,
    (match: string, identifier: string | undefined, offset: number) => {
      // A GitHub Actions `${{ ... }}` expression — emit it verbatim.
      if (match.startsWith("$")) return match;
      if (identifier === undefined) return match === "{{" ? "{" : "}";
      // `${identifier}` (JS template literal / shell): the `{` is preceded by
      // `$`, so this is code, not a placeholder — leave it untouched.
      if (offset > 0 && template[offset - 1] === "$") return match;
      if (!(identifier in vars)) {
        warnings.push(identifier);
        return match;
      }
      const value = vars[identifier];
      if (value === null || value === undefined) {
        warnings.push(identifier);
        return match;
      }
      return String(value);
    },
  );

  return { output, warnings };
}
