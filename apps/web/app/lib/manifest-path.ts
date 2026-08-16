import path from "path";
// Deliberately imported from the composition root rather than from
// `./monorepo-root` directly. `wire.server` re-exports `findMonorepoRoot`
// precisely so every server-side consumer reaches the anchor through one
// module — which also means the route suites that mock `@/lib/wire.server`
// keep controlling the anchor this helper resolves. Importing the concrete
// module here would silently escape those mocks and let the anchor tests pass
// while exercising the real filesystem.
import { findMonorepoRoot } from "@/lib/wire.server";

/** The manifest every architecture-modify route falls back to. */
export const DEFAULT_MANIFEST_PATH = ".architecture/manifest.yaml";

/**
 * Resolve a client-supplied manifest path and confine it to `.architecture/`
 * (AUD-004 — this was copy-pasted into all four `api/architecture/modify`
 * routes; four copies of a traversal gate is four places for it to drift).
 *
 * The anchor is NOT a parameter. AUD-002 was exactly the bug of validating
 * against `process.cwd()` (= `apps/web` under the standalone Next build) while
 * the mutation and lint adapters anchored on the monorepo root — the check
 * guarded a directory nothing wrote to. Taking a `root` argument would leave
 * that mistake expressible at four call sites; resolving it internally makes it
 * unrepresentable.
 *
 * @param rawPath Client-supplied path, or null/undefined for the default.
 * @returns The absolute, confined manifest path.
 * @throws {MonorepoRootNotFoundError} If the on-disk anchor is missing. This is
 *   a server configuration failure — callers must map it to 5xx, NOT to the 400
 *   they use for the traversal error below.
 * @throws {Error} If the path escapes `.architecture/`, or is not a string.
 */
export function validateManifestPath(
  rawPath?: string | null | undefined,
): string {
  const requested = rawPath ?? DEFAULT_MANIFEST_PATH;

  // A non-string would otherwise reach `path.resolve` and throw a raw Node
  // TypeError, which the routes' catch blocks would echo back as the client
  // error message. Reject it here with the same message as a traversal, so a
  // malformed body cannot probe for `path.resolve`'s internals.
  if (typeof requested !== "string") {
    throw new Error(
      `Invalid path: traversal detected. Path must be within .architecture directory.`,
    );
  }

  const root = findMonorepoRoot();
  const allowedBase = path.join(root, ".architecture");
  const resolvedPath = path.resolve(root, requested);

  // The `+ path.sep` matters: a bare `startsWith(allowedBase)` would also admit
  // a sibling like `.architecture-attacker/`, whose resolved path shares the
  // prefix but is outside the allowed directory.
  if (
    !resolvedPath.startsWith(allowedBase + path.sep) &&
    resolvedPath !== allowedBase
  ) {
    throw new Error(
      `Invalid path: traversal detected. Path must be within .architecture directory.`,
    );
  }

  return resolvedPath;
}
