// A placeholder is a *bare* `{identifier}`. Anything `$`-prefixed is code, not a
// placeholder, and must pass through untouched:
//   - `${{ ... }}` — GitHub Actions expression (matched first, whole, so its
//     inner `{{`/`}}` never reach the escape rules; non-greedy body so adjacent
//     `${{ a }}${{ b }}` don't merge).
//   - `${ ... }`   — JS template literal / shell expansion: the `(?<!\$)`
//     lookbehind stops the placeholder rule from matching the `{...}` inside it,
//     so e.g. `${res.status}` or `${COOKIE_NAME}` are left verbatim (no spurious
//     "unresolved variable" warning, and no risk of a `${someQuestionId}` being
//     silently rewritten in emitted code).
const TOKEN_RE =
  /\$\{\{[\s\S]*?\}\}|\{\{|\}\}|(?<!\$)\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

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

  const output = template.replace(TOKEN_RE, (match, identifier?: string) => {
    // A GitHub Actions `${{ ... }}` expression — emit it verbatim.
    if (match.startsWith("$")) return match;
    if (identifier === undefined) return match === "{{" ? "{" : "}";
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
  });

  return { output, warnings };
}
