/**
 * Reference implementation backing docs/kernel/GRANT.md.
 *
 * Deliberately standalone: no import of `PendingManifestMutation`, no
 * `fs`, no dependency on any `application`/`infrastructure` port in this
 * package. It exists so the acceptance tests in
 * `grant.acceptance.test.ts` (same directory) have something executable to
 * run against — it is NOT wired into `AcceptTransactionToolUseCase`, the
 * tool registry, or the composition root. It lives under `docs/kernel/spike/`,
 * outside `packages/mcp-server/src` and its barrel, deliberately: mcp-server
 * does not import it. That wiring, and the `hexagen grant compile|show|check`
 * CLI surface described in docs/kernel/GRANT.md, are a follow-up
 * implementation slice, not this one.
 *
 * See docs/kernel/grant.schema.json for the wire shape this mirrors.
 */

/** A compiled, minimal manifest — just enough to validate context names. */
export interface GrantManifest {
  bounded_contexts?: Array<{ name: string }>;
}

export interface Grant {
  readonly contexts: readonly string[];
  readonly paths: readonly string[];
}

/**
 * A reference to the one thing a pending mutation would write to, in the
 * shape every kind in `PendingManifestMutation` reduces to (see the
 * "Enforcement point" table in docs/kernel/GRANT.md for which input field
 * each real mutation kind supplies as `context`).
 */
export interface MutationRef {
  readonly kind: string;
  readonly context: string;
}

export type GrantCheck =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

function contextPathPrefix(contextName: string): string {
  return `packages/${contextName}/`;
}

/**
 * Compile a Grant from context names plus the manifest they must exist in.
 * Fails closed: an unknown context name is a thrown compile error, never a
 * silently-dropped entry.
 */
export function compileGrant(
  contexts: readonly string[],
  manifest: GrantManifest,
  extraPaths: readonly string[] = [],
): Grant {
  const known = new Set(
    (manifest.bounded_contexts ?? []).map((context) => context.name),
  );
  const unknown = contexts.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `Grant names unknown manifest context(s): ${unknown.join(", ")}`,
    );
  }
  const compiledPaths = [
    ...contexts.map(contextPathPrefix),
    ...extraPaths,
  ];
  return {
    contexts: [...contexts],
    paths: [...new Set(compiledPaths)],
  };
}

function normalizePath(relativePath: string): string {
  return relativePath.split("\\").join("/");
}

function isPathInGrant(grant: Grant, relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  return grant.paths.some((allowed) => normalized.startsWith(allowed));
}

/**
 * Default-deny check for one pending mutation: both the mutation's owning
 * context AND its expected path must be granted. Neither check alone is
 * sufficient — see docs/kernel/GRANT.md "Enforcement point".
 */
export function checkMutationAgainstGrant(
  grant: Grant,
  mutation: MutationRef,
): GrantCheck {
  if (!grant.contexts.includes(mutation.context)) {
    return {
      allowed: false,
      reason: `Grant does not include context '${mutation.context}' (mutation: ${mutation.kind})`,
    };
  }
  const expectedPath = contextPathPrefix(mutation.context);
  if (!isPathInGrant(grant, expectedPath)) {
    return {
      allowed: false,
      reason: `Grant does not include path '${expectedPath}' for context '${mutation.context}' (mutation: ${mutation.kind})`,
    };
  }
  return { allowed: true };
}
