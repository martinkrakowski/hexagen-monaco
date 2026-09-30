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
  /**
   * HMAC-SHA256 (hex) over `canonicalGrantPayload(this)`, keyed by the
   * trusted secret at `.hexagen/grant-signing.key` — see
   * `GrantSignaturePort`/`GrantSignatureAdapter`. A caller-supplied grant
   * with no signature, or one that doesn't verify, is never trusted as
   * authorization (docs/kernel/GRANT.md "Enforcement point"): the fields
   * above describe a scope, but only a valid signature says a trusted
   * issuer actually granted it.
   */
  readonly signature?: string;
}

/**
 * The exact bytes a Grant's signature is computed over: every field except
 * `signature` itself, as JSON with keys in a fixed sorted order — so the
 * same grant always canonicalizes to the same string regardless of the
 * property order it was constructed or parsed in.
 */
export function canonicalGrantPayload(grant: Grant): string {
  const signable: Omit<Grant, "signature"> = {
    id: grant.id,
    principal: grant.principal,
    agent: grant.agent,
    contexts: grant.contexts,
    paths: grant.paths,
    tools: grant.tools,
    mode: grant.mode,
    max_files: grant.max_files,
    expires_at: grant.expires_at,
    revoked_at: grant.revoked_at,
  };
  return JSON.stringify(signable, Object.keys(signable).sort());
}

/** What one pending mutation would write: its proposing tool and owning context. */
export interface MutationRef {
  readonly tool: string;
  readonly context: string;
}

/**
 * Machine-readable denial category, set once at the point each check fails
 * rather than re-derived later by pattern-matching the human-readable
 * `reason` string (that string can embed caller-controlled values — a
 * context or grant id containing the word "expired" — so matching against
 * it is not safe; see accept-transaction-tool.use-case.ts `haltReasonFor`,
 * which this field replaces).
 */
export type GrantDenialCode =
  | "grant_denied"
  | "grant_expired"
  | "grant_revoked";

export type GrantCheck =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: string;
      readonly code: GrantDenialCode;
    };

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
 * The three scaffolding mutations write into `packages/<context>/` before
 * the manifest is ever touched (`SyncEngineAdapter.createPort` /
 * `createAdapter` / `scaffoldModule` — the target directory is derived from
 * the mutation's own input, deterministically, before any file is written).
 * A grant scoped to `.architecture/` alone does not cover that write, so it
 * is checked as a second, independent required path for these three kinds.
 * `create-context`, `add-dependency`, `remove-port`, and `remove-context`
 * only ever touch the manifest.
 */
function additionalWritePath(mutation: PendingManifestMutation): string | null {
  switch (mutation.kind) {
    case "create-port":
    case "create-adapter":
    case "scaffold-module":
      return `packages/${deriveMutationRef(mutation).context}/`;
    default:
      return null;
  }
}

/**
 * Upper bound on the files a mutation can create, known from its kind alone
 * (before any port is called): `create-port` and `create-adapter` each
 * write exactly one file; `scaffold-module` writes at most four
 * (`package.json`, `tsconfig.json`, `src/index.ts`, and the layer's
 * `index.ts` — fewer when some already exist); every other kind only edits
 * the manifest in place and creates nothing.
 */
function maxPossibleFiles(mutation: PendingManifestMutation): number {
  switch (mutation.kind) {
    case "create-port":
    case "create-adapter":
      return 1;
    case "scaffold-module":
      return 4;
    default:
      return 0;
  }
}

/**
 * Rule from GRANT.md "Enforcement point": every independent check below
 * must hold, or the mutation is denied outright — no partial-match, no
 * warn-but-allow. An empty `grant.tools` or `grant.contexts` denies
 * everything by construction (nothing can match an empty allowlist).
 */
export function checkMutationAgainstGrant(
  grant: Grant,
  mutation: MutationRef,
  pending: PendingManifestMutation,
): GrantCheck {
  if (!grant.tools.includes(mutation.tool)) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant does not include tool '${mutation.tool}'`,
    };
  }
  if (!grant.contexts.includes(mutation.context)) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant does not include context '${mutation.context}' (tool: ${mutation.tool})`,
    };
  }
  if (!isPathInGrant(grant, MANIFEST_WRITE_PATH)) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant does not include path '${MANIFEST_WRITE_PATH}' (the manifest write target)`,
    };
  }
  const packagePath = additionalWritePath(pending);
  if (packagePath && !isPathInGrant(grant, packagePath)) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant does not include path '${packagePath}' (the scaffolding write target for tool: ${mutation.tool})`,
    };
  }
  const cap = maxPossibleFiles(pending);
  if (grant.max_files !== undefined && cap > grant.max_files) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant's max_files (${grant.max_files}) is smaller than the up to ${cap} file(s) tool '${mutation.tool}' can create`,
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
  const expiresAtMillis = Date.parse(grant.expires_at);
  if (Number.isNaN(expiresAtMillis)) {
    return {
      allowed: false,
      code: "grant_expired",
      reason: `Grant '${grant.id}' has an invalid expires_at timestamp: '${grant.expires_at}'`,
    };
  }
  if (grant.revoked_at !== undefined) {
    const revokedAtMillis = Date.parse(grant.revoked_at);
    if (Number.isNaN(revokedAtMillis)) {
      return {
        allowed: false,
        code: "grant_revoked",
        reason: `Grant '${grant.id}' has an invalid revoked_at timestamp: '${grant.revoked_at}'`,
      };
    }
    if (nowMillis >= revokedAtMillis) {
      return {
        allowed: false,
        code: "grant_revoked",
        reason: `Grant '${grant.id}' was revoked at ${grant.revoked_at}`,
      };
    }
  }
  if (nowMillis > expiresAtMillis) {
    return {
      allowed: false,
      code: "grant_expired",
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
      code: "grant_denied",
      reason: `Grant '${grant.id}' has mode '${grant.mode}'; only 'write' grants may accept transactions`,
    };
  }
  return { allowed: true };
}
