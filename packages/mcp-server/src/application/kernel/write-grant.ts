import { isPathInSlice } from "@hexagen/shared";
import type { Grant, GrantCheck } from "./grant.js";

/** A client-repo write: the tool asking, and every repo-relative path it would touch. */
export interface WriteRef {
  readonly tool: string;
  readonly paths: readonly string[];
}

/**
 * Field Kit enforcement: tools and paths only (no contexts, no manifest, no
 * `packages/<ctx>/` derivation). Every path goes through the brownfield
 * slice-path rules before matching (`isPathInSlice`, with no excludes): an
 * entry ending `/` is a directory prefix, any other entry is an exact path,
 * matching is case-sensitive, and the filesystem is never consulted. An
 * empty `paths` input is a denial, never an allow.
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
    if (!isPathInSlice(slice, candidate)) {
      return {
        allowed: false,
        code: "grant_denied",
        reason: `Grant does not include path '${candidate}' (tool: ${write.tool})`,
      };
    }
  }
  return { allowed: true };
}
