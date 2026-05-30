// Order matters: the leading `${{ ... }}` alternative is matched first so a
// GitHub Actions expression is consumed whole and its inner `{{`/`}}` are never
// seen by the escape rules. The body is non-greedy so adjacent expressions
// (`${{ a }}${{ b }}`) don't merge into one match.
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
 * - GitHub Actions `${{ ... }}` expressions pass through untouched, so workflow
 *   templates can use them without quadrupling braces.
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
