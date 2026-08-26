/**
 * Derive a slug suggestion from a human-entered name: lowercased,
 * non-alphanumerics collapsed to single hyphens, trimmed of leading/trailing
 * hyphens, clipped to the 40-char ceiling `ORG_SLUG_PATTERN` allows.
 *
 * This is a SUGGESTION, not validation — the form still validates the final
 * value against `ORG_SLUG_PATTERN` (app/lib/adapters/http-orgs.adapter.ts),
 * and the server's UNIQUE index remains the authority on collisions.
 */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}
