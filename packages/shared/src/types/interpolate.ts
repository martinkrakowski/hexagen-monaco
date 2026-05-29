const TOKEN_RE = /\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

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
 * - A single pass only — values containing braces are not re-interpolated.
 */
export function interpolate(
  template: string,
  vars: Record<string, unknown>,
): InterpolationResult {
  const warnings: string[] = [];

  const output = template.replace(TOKEN_RE, (match, identifier?: string) => {
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
