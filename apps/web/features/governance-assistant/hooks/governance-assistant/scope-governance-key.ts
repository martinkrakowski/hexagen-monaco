/**
 * Scopes a governance context key under its owning project.
 *
 * The storage key for a governance thread is
 *   `hexagen:governance:` + scopeGovernanceKey(projectId, contextKey)
 * i.e. `hexagen:governance:<projectId>-<contextKey>`. The `<projectId>-`
 * separator is deliberate: it is exactly the range prefix
 * `purgeProjectDataAtomic` deletes, so deleting a project deletes its threads.
 *
 * Returns the *scoped* key only — the caller still passes the bare
 * contextKey to the legacy-key adoption path.
 */
export function scopeGovernanceKey(
  projectId: string | null,
  contextKey: string,
): string {
  const scope = projectId ?? "unsaved";
  return `${scope}-${contextKey}`;
}
