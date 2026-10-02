import { isPathInSlice } from "./brownfield/slice-path.js";

/**
 * The scope and window checks of a Grant, shared by the MCP server's accept
 * path and the `hexagen grant check` CLI so the two cannot drift. Pure: no fs, no
 * clock (the caller passes `now`), no signature handling.
 */

export interface Grant {
  readonly id: string;
  readonly principal: string;
  readonly agent: string;
  /** Absent on a client-repo grant (never `[]`); absent denies every monaco mutation. */
  readonly contexts?: readonly string[];
  readonly paths: readonly string[];
  readonly tools: readonly string[];
  readonly mode: "write" | "propose";
  readonly max_files?: number;
  readonly expires_at: string;
  readonly revoked_at?: string;
  /**
   * HMAC-SHA256 (hex) over the canonical payload, keyed by the trusted
   * secret. A grant with no signature, or one that does not verify, is never
   * trusted as authorization (docs/kernel/GRANT.md "Enforcement point").
   */
  readonly signature?: string;
}

/**
 * Machine-readable denial category, set once at the point each check fails
 * rather than re-derived by pattern-matching the human-readable `reason`.
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

/** A client-repo write: the tool asking, and every repo-relative path it would touch. */
export interface WriteRef {
  readonly tool: string;
  readonly paths: readonly string[];
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
 * Field Kit scope check: tools and paths only (no contexts, no manifest, no
 * `packages/<ctx>/` derivation). It is
 * scope-only: it does not verify provenance or timing. The caller must verify
 * the signature and then run `checkGrantWindow` first, and must touch
 * no write port if either denies. It must NOT run `checkGrantMode` on the
 * propose path: client grants are propose-only (`mode: "propose"`), so the
 * mode check would deny every patch.
 *
 * Every path goes through the brownfield slice-path rules before matching
 * (`isPathInSlice`, no excludes): an entry ending `/` is a directory prefix,
 * any other entry is an exact path, matching is case-sensitive, and the
 * filesystem is never consulted. Matching is text-only by intent; both sides
 * are NFC-normalised before comparing (`isPathInSlice`), and the caller's
 * on-disk spelling check guards case tricks. A candidate ending `/` is refused (a write target is a file). An
 * empty `paths` input is a denial, never an allow. The tool is checked
 * before the paths, and the distinct-path count is checked against
 * `max_files` (when set) after the per-path checks.
 */
export function checkWriteAgainstGrant(
  grant: Grant,
  write: WriteRef,
): GrantCheck {
  if (!grant.tools.includes(write.tool)) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant does not include tool '${write.tool}'`,
    };
  }
  if (write.paths.length === 0) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `No paths supplied for tool '${write.tool}'; refusing to allow an empty write`,
    };
  }
  const slice = { paths: grant.paths, excludes: [] };
  for (const candidate of write.paths) {
    if (candidate.endsWith("/")) {
      return {
        allowed: false,
        code: "grant_denied",
        reason: `Path '${candidate}' is a directory; a write target must be a file (tool: ${write.tool})`,
      };
    }
    if (!isPathInSlice(slice, candidate)) {
      return {
        allowed: false,
        code: "grant_denied",
        reason: `Grant does not include path '${candidate}' (tool: ${write.tool})`,
      };
    }
  }
  const distinct = new Set(write.paths).size;
  if (grant.max_files !== undefined && distinct > grant.max_files) {
    return {
      allowed: false,
      code: "grant_denied",
      reason: `Grant's max_files (${grant.max_files}) is smaller than the ${distinct} distinct path(s) requested (tool: ${write.tool})`,
    };
  }
  return { allowed: true };
}
