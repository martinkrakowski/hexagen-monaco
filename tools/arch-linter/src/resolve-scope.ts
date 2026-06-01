/**
 * Resolve the project's npm scope from its manifest — a dependency-free mirror
 * of `@hexagen/sync`'s `resolveScope()` / `sanitizeScope()`.
 *
 * The generator emits package names under `@${resolveScope(manifest)}/…` with
 * precedence `scope → system → "generated-project"`, sanitized to a legal npm
 * scope. The linter MUST resolve the identical value or its `startsWith(SCOPE)`
 * checks classify scoped imports against the wrong namespace.
 *
 * Kept self-contained (no import from `@hexagen/sync`) so the linter doesn't
 * pull the sync bundle in. TODO(item-0): consolidate into a shared package when
 * arch-linter is restructured for publishing.
 *
 * @returns the scope **without** the leading `@`.
 */
export function resolveLintScope(m: {
  scope?: string;
  system?: string;
}): string {
  const raw =
    typeof m.scope === "string" && m.scope.length > 0
      ? m.scope
      : typeof m.system === "string" && m.system.length > 0
        ? m.system
        : "generated-project";
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .slice(0, 214)
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned.length > 0 ? cleaned : "generated-project";
}
