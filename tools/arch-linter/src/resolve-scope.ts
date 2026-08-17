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

/** `@scope` strings to try, primary first; extras are de-duplicated. */
export function scopesToTry(
  primary: string,
  extra: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const cleaned = raw.replace(/^@+/, "").trim();
    if (cleaned.length === 0) return;
    const scoped = `@${cleaned}`;
    if (!out.includes(scoped)) out.push(scoped);
  };
  push(primary);
  for (const s of extra) push(s);
  return out;
}

/** The `@scope` a specifier belongs to, or null if none of `scopes` match. */
export function matchingImportScope(
  moduleSpecifier: string,
  scopes: readonly string[],
): string | null {
  for (const scope of scopes) {
    if (moduleSpecifier.startsWith(`${scope}/`)) return scope;
  }
  return null;
}

/**
 * A bare (unscoped) specifier is a workspace import only when its first
 * segment is a known context name — `js-yaml` must never match.
 */
export function unscopedContextImport(
  moduleSpecifier: string,
  contextNames: ReadonlySet<string>,
): string | null {
  if (
    moduleSpecifier.startsWith("@") ||
    moduleSpecifier.startsWith(".") ||
    moduleSpecifier.startsWith("/")
  ) {
    return null;
  }
  const head = moduleSpecifier.split("/")[0];
  return head && contextNames.has(head) ? head : null;
}

/**
 * An unscoped specifier is a workspace import only when it actually
 * resolves inside a known context root — not when it merely shares a name
 * with a context (`zod`, `logger`, `ui`).
 */
export function resolvedPathIsWorkspaceImport(
  resolvedPath: string | undefined,
  contextRoots: readonly string[],
): boolean {
  if (!resolvedPath) return false;
  const posix = resolvedPath.replace(/\\/g, "/");
  if (posix.includes("/node_modules/") || posix.includes("/node_modules\\")) {
    return false;
  }
  return contextRoots.some((root) => {
    const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
    return posix === r || posix.startsWith(`${r}/`);
  });
}
