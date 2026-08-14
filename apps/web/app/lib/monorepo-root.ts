import { existsSync } from "fs";
import { join, dirname } from "path";

/**
 * Thrown when no `.architecture/manifest.yaml` can be located by walking up from
 * the start directory. This is a server-side packaging/configuration failure —
 * the manifest anchor is missing on disk — NOT a client input error. API routes
 * map it to 500 (distinct from the 400 they return for path-traversal input) so
 * a missing anchor surfaces to 5xx monitoring instead of masquerading as a bad
 * request.
 */
export class MonorepoRootNotFoundError extends Error {
  /**
   * Stable, path-free message for API/SSE responses. The detailed `Error.message`
   * embeds the absolute `from` (= process.cwd()) path and is for SERVER LOGS ONLY
   * — never return it in a response body. These routes run under active wildcard
   * CORS, so echoing the raw message would disclose the server filesystem layout
   * to cross-origin callers (CWE-209 information exposure).
   */
  static readonly clientMessage = "Monorepo root not found";

  constructor(message: string) {
    super(message);
    this.name = "MonorepoRootNotFoundError";
  }
}

/**
 * Find the monorepo root by searching upward for .architecture/manifest.yaml.
 *
 * This is the single manifest-path anchor for every server-side consumer:
 * route path validation, the transaction mutation/lint adapters, and the
 * read-only manifest / architecture-graph display providers all resolve the
 * manifest against this one root rather than process.cwd(). Under the standalone
 * Next build, process.cwd() is apps/web, not the monorepo root — so anchoring on
 * it makes those consumers disagree about where the manifest lives (mutations
 * target the wrong directory; display providers silently read nothing). Anchoring
 * every one of them here keeps them consistent.
 *
 * @param from Starting directory (defaults to process.cwd())
 * @returns Monorepo root path
 * @throws Error if no manifest found
 */
export function findMonorepoRoot(from: string = process.cwd()): string {
  let current = from;

  // Walk upward until the manifest anchor is found or the filesystem root is
  // reached — dirname('/') === '/' (and dirname('C:\\') === 'C:\\'), so the
  // `parent === current` check is the true terminator. No fixed depth cap: a
  // deeply nested start directory must still be able to locate a valid root.
  for (;;) {
    const manifestPath = join(current, ".architecture", "manifest.yaml");
    if (existsSync(manifestPath)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new MonorepoRootNotFoundError(
        `Could not locate monorepo root from ${from}. No .architecture/manifest.yaml found.`,
      );
    }
    current = parent;
  }
}
