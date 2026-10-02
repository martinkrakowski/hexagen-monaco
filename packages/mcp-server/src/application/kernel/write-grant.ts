import { isPathInSlice } from "@hexagen/shared";
import type { Grant, GrantCheck } from "./grant.js";

/** A client-repo write: the tool asking, and every repo-relative path it would touch. */
export interface WriteRef {
  readonly tool: string;
  readonly paths: readonly string[];
}

/**
 * Field Kit scope check: tools and paths only (no contexts, no manifest, no
 * `packages/<ctx>/` derivation). Like `checkMutationAgainstGrant`, it is
 * scope-only: it does not verify provenance or timing. The caller must run
 * `checkGrantSignature` and then `checkGrantWindow` first, and must touch
 * no write port if either denies. It must NOT run `checkGrantMode` on the
 * propose path: client grants are propose-only (`mode: "propose"`), so the
 * mode check would deny every patch.
 *
 * Every path goes through the brownfield slice-path rules before matching
 * (`isPathInSlice`, no excludes): an entry ending `/` is a directory prefix,
 * any other entry is an exact path, matching is case-sensitive, and the
 * filesystem is never consulted. Matching is text-only by intent: there is
 * no Unicode (NFC) normalisation; the caller's on-disk spelling check is the
 * guard. A candidate ending `/` is refused (a write target is a file). An
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
