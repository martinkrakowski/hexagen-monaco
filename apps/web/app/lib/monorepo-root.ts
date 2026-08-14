import { existsSync } from "fs";
import { join, dirname } from "path";

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
  const maxDepth = 10; // Prevent infinite loop
  let depth = 0;

  while (depth < maxDepth) {
    const manifestPath = join(current, ".architecture", "manifest.yaml");
    if (existsSync(manifestPath)) {
      return current;
    }
    const parent = dirname(current);
    depth++;
    if (parent === current) {
      throw new Error(
        `Could not locate monorepo root from ${from}. No .architecture/manifest.yaml found.`,
      );
    }
    current = parent;
  }

  throw new Error(
    `Could not locate monorepo root from ${from}. Maximum search depth (${maxDepth}) exceeded.`,
  );
}
