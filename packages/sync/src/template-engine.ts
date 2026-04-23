// template-engine.ts – minimal `{variable}` string interpolation helper for SyncEngine.
//
// Zero dependencies. No I/O. No logging. Pure function.
// Callers (e.g. Wave 2 generators) decide what to do with the returned warnings —
// typically they will surface them through the `report` or `logger` plumbing that
// already exists in `sync-engine.ts` / `fs-utils.ts`.

/**
 * Regex matching a single template token.
 *
 * Two branches, in order of priority:
 *
 * 1. `\{\{|\}\}` — escape sequences. `{{` produces a literal `{`, `}}` produces `}`.
 *    Placed first so `{{x}}` is never misread as `{` + placeholder `{x}` + `}`.
 *
 * 2. `\{([A-Za-z_][A-Za-z0-9_.-]*)\}` — a placeholder. The captured identifier may
 *    contain letters, digits, underscores, dots and hyphens, and must start with a
 *    letter or underscore. Dots are allowed only so that callers can use keys like
 *    `"foo.bar"` literally in `vars` (nested property access is NOT performed — the
 *    whole string between braces is used as-is as a lookup key).
 *
 * The regex is intentionally conservative: unmatched shapes like `{}`, `{ name }`,
 * `{123}`, or a dangling `{` are left untouched in the output.
 */
const TOKEN_RE = /\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

/**
 * Result of a single call to {@link interpolate}.
 *
 * - `output`  — the template with all resolved placeholders replaced and escape
 *   sequences unwrapped.
 * - `warnings` — list of identifier names that appeared as `{name}` placeholders but
 *   were absent (or `null` / `undefined`) in `vars`. Every occurrence is recorded
 *   separately; callers may dedupe with `new Set(warnings)` if they wish.
 */
export interface InterpolationResult {
  output: string;
  warnings: string[];
}

/**
 * Replace `{variable}` placeholders in a template string with values from `vars`.
 *
 * Rules:
 *
 * - **Identifiers.** Only a single identifier is allowed inside the braces:
 *   `{name}`, `{system}`, `{scope}`. The identifier must match the pattern
 *   `[A-Za-z_][A-Za-z0-9_.-]*`. Shapes that do not match (e.g. `{}`, `{ name }`,
 *   `{1x}`) are left in place verbatim and do NOT produce a warning.
 *
 * - **No nested access.** `{foo.bar}` is treated as a single identifier with the
 *   literal key `"foo.bar"`. It only resolves when `vars["foo.bar"]` is set; it
 *   will not drill into `vars.foo.bar`. This keeps the resolver flat and trivially
 *   predictable — consistent with the design note in
 *   `docs/sync-engine-unified-scaffolding-plan.md` §Wave 1 Sub-agent 1b.
 *
 * - **Missing variables.** If a matched identifier is absent from `vars`, or its
 *   value is `null` or `undefined`, the placeholder is left in the output verbatim
 *   (e.g. `{unknownVar}`) and the identifier is appended to `warnings`. Leaving the
 *   placeholder visible is deliberate: it makes author mistakes obvious in the
 *   generated file instead of silently producing an empty string.
 *
 * - **Stringification.** Present values are coerced with `String(value)`. Numbers,
 *   booleans, bigints, objects with a useful `toString()`, etc. all work. Values
 *   that stringify to strings containing `{` are NOT re-interpolated — a single
 *   pass is performed.
 *
 * - **Escaping.** `{{` produces a literal `{` in the output; `}}` produces a
 *   literal `}`. This lets templates embed JSON, TypeScript generics, CSS-in-JS,
 *   or any other content that contains brace characters without those braces being
 *   mistaken for placeholders. Escaping is independent: `{{` and `}}` do not need
 *   to be paired and do not form a wrapper.
 *
 * Example:
 * ```ts
 * interpolate("Hello {name}! {{raw}} {missing}", { name: "World" })
 * // → { output: "Hello World! {raw} {missing}", warnings: ["missing"] }
 * ```
 *
 * The function is pure: no I/O, no mutation of `vars`, no thrown exceptions on
 * missing variables (collected into `warnings` instead). Callers choose whether a
 * non-empty `warnings` list should be treated as a failure.
 *
 * Edge cases deliberately NOT handled:
 * - Whitespace inside braces (`{ name }`) — treated as literal text, no match.
 * - Unicode identifiers — ASCII-only by design; keeps the regex deterministic
 *   across locales.
 * - Recursive interpolation — values are inserted as-is; if a value contains a
 *   `{x}` placeholder it will NOT be resolved in a second pass.
 * - Custom formatters / filters (Mustache-style `{name | upper}`) — out of scope
 *   for the sync engine's needs.
 *
 * @param template - The template string to interpolate.
 * @param vars     - Flat map of identifier → value. Keys are looked up verbatim.
 * @returns An {@link InterpolationResult} with the interpolated `output` and the
 *   list of missing-variable identifiers.
 */
export function interpolate(
  template: string,
  vars: Record<string, unknown>,
): InterpolationResult {
  const warnings: string[] = [];

  const output = template.replace(TOKEN_RE, (match, identifier?: string) => {
    // Escape sequences: `{{` → `{`, `}}` → `}`. When this branch matches, the
    // capture group `identifier` is undefined.
    if (identifier === undefined) {
      return match === "{{" ? "{" : "}";
    }

    // Identifier branch. Use `in` to distinguish "missing key" from "key present
    // but value is falsy" (e.g. `0`, `false`, or `""`) — all three of those are
    // legitimate substitutions.
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
