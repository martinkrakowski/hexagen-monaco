/**
 * Grant enforcement for the `hexagen_accept_transaction` choke point.
 *
 * Extends the standalone reference in docs/kernel/spike/grant.ts (contexts →
 * `packages/<context>/` paths, default-deny context/path check) with the
 * fields docs/kernel/GRANT.md marks "schema-only until the Trace thread
 * gives `id` somewhere to be referenced from": `id`, `principal`, `agent`,
 * `tools`, `mode`, `expires_at`, `revoked_at`. This is that thread — the
 * spike is deliberately left in place (docs/kernel/GRANT.md still points to
 * it as the "Keep" slice reference); this module is the wiring GRANT.md
 * says does not exist yet, now that it does.
 *
 * See docs/kernel/grant.schema.json for the wire shape.
 */
import type { PendingManifestMutation } from "../pending-manifest-mutation.js";

export interface Grant {
  readonly id: string;
  readonly principal: string;
  readonly agent: string;
  readonly contexts: readonly string[];
  readonly paths: readonly string[];
  readonly tools: readonly string[];
  readonly mode: "write" | "propose";
  readonly max_files?: number;
  readonly expires_at: string;
  readonly revoked_at?: string;
}

/** What one pending mutation would write: its proposing tool and owning context. */
export interface MutationRef {
  readonly tool: string;
  readonly context: string;
}

export type GrantCheck =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * The one path every monaco manifest mutation actually writes through
 * (`ManifestWriteAdapter` → `.architecture/manifest.yaml`), regardless of
 * which bounded context the mutation names. PR #690's review flagged this
 * as a known gap: a grant scoped to `packages/<context>/` (the spike's
 * derivation) never covers this file, so every accept would deny. This is
 * the fix — the path check below verifies `.architecture/` is granted, not
 * a per-context package prefix.
 */
export const MANIFEST_WRITE_PATH = ".architecture/";

/**
 * Each `PendingManifestMutation` names exactly one context it would write
 * to and one MCP tool that proposed it — see docs/kernel/GRANT.md
 * "Enforcement point". `add-dependency`'s context is `sourceModule` (the
 * side that gets written); `targetModule` is only read.
 */
export function deriveMutationRef(
  mutation: PendingManifestMutation,
): MutationRef {
  switch (mutation.kind) {
    case "create-context":
      return { tool: "hexagen_create_context", context: mutation.input.name };
    case "scaffold-module":
      return {
        tool: "hexagen_scaffold_module",
        context: mutation.input.name,
      };
    case "add-dependency":
      return {
        tool: "hexagen_add_dependency",
        context: mutation.input.sourceModule,
      };
    case "create-port":
      return {
        tool: "hexagen_create_port",
        context: mutation.input.domain_name,
      };
    case "create-adapter":
      return {
        tool: "hexagen_create_adapter",
        context: mutation.input.infrastructure_name,
      };
    case "remove-port":
      return {
        tool: "hexagen_remove_port",
        context: mutation.input.context_name,
      };
    case "remove-context":
      return {
        tool: "hexagen_remove_context",
        context: mutation.input.context_name,
      };
  }
}

function normalizePath(relativePath: string): string {
  return relativePath.split("\\").join("/");
}

function isPathInGrant(grant: Grant, relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  return grant.paths.some((allowed) => normalized.startsWith(allowed));
}

/**
 * Rule from GRANT.md "Enforcement point": all three independent checks
 * must hold, or the mutation is denied outright — no partial-match, no
 * warn-but-allow. An empty `grant.tools` or `grant.contexts` denies
 * everything by construction (nothing can match an empty allowlist).
 */
export function checkMutationAgainstGrant(
  grant: Grant,
  mutation: MutationRef,
): GrantCheck {
  if (!grant.tools.includes(mutation.tool)) {
    return {
      allowed: false,
      reason: `Grant does not include tool '${mutation.tool}'`,
    };
  }
  if (!grant.contexts.includes(mutation.context)) {
    return {
      allowed: false,
      reason: `Grant does not include context '${mutation.context}' (tool: ${mutation.tool})`,
    };
  }
  if (!isPathInGrant(grant, MANIFEST_WRITE_PATH)) {
    return {
      allowed: false,
      reason: `Grant does not include path '${MANIFEST_WRITE_PATH}' (the manifest write target)`,
    };
  }
  return { allowed: true };
}

/**
 * Rule from Martin's spec (2026-09-30): call time == revoked_at is denied,
 * == expires_at is allowed, > expires_at is denied. Revocation is
 * immediate (at-or-after); expiry is a closed interval (at-or-before is
 * still in-window).
 */
export function checkGrantWindow(grant: Grant, now: Date): GrantCheck {
  const nowMillis = now.getTime();
  if (grant.revoked_at) {
    const revokedAtMillis = Date.parse(grant.revoked_at);
    if (nowMillis >= revokedAtMillis) {
      return {
        allowed: false,
        reason: `Grant '${grant.id}' was revoked at ${grant.revoked_at}`,
      };
    }
  }
  const expiresAtMillis = Date.parse(grant.expires_at);
  if (nowMillis > expiresAtMillis) {
    return {
      allowed: false,
      reason: `Grant '${grant.id}' expired at ${grant.expires_at}`,
    };
  }
  return { allowed: true };
}

/**
 * `mode: "propose"` grants may only create a Transaction, never accept one.
 */
export function checkGrantMode(grant: Grant): GrantCheck {
  if (grant.mode !== "write") {
    return {
      allowed: false,
      reason: `Grant '${grant.id}' has mode '${grant.mode}'; only 'write' grants may accept transactions`,
    };
  }
  return { allowed: true };
}
