import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";

// The helper reaches the anchor through the composition root, so mocking
// `@/lib/wire.server` is what controls it — the same seam the four route suites
// use. The REAL MonorepoRootNotFoundError is re-exported so the rethrow test
// exercises the production error type rather than a look-alike.
vi.mock("@/lib/wire.server", async () => {
  const { MonorepoRootNotFoundError } = await vi.importActual<
    typeof import("@/lib/monorepo-root")
  >("@/lib/monorepo-root");
  return { findMonorepoRoot: vi.fn(), MonorepoRootNotFoundError };
});

import { validateManifestPath, DEFAULT_MANIFEST_PATH } from "../manifest-path";
import { findMonorepoRoot, MonorepoRootNotFoundError } from "@/lib/wire.server";

const TRAVERSAL = /traversal detected/;

describe("validateManifestPath", () => {
  beforeEach(() => {
    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");
    // Prod cwd (apps/web) differs from the monorepo root. Anything anchored on
    // cwd instead of the root would land under this path and be visible below.
    vi.spyOn(process, "cwd").mockReturnValue("/fake/repo/apps/web");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the repo manifest when no path is supplied", () => {
    assert.equal(
      validateManifestPath(undefined),
      "/fake/repo/.architecture/manifest.yaml",
    );
    assert.equal(DEFAULT_MANIFEST_PATH, ".architecture/manifest.yaml");
  });

  it("treats a null path as absent (JSON `null` must not become a TypeError)", () => {
    assert.equal(
      validateManifestPath(null),
      "/fake/repo/.architecture/manifest.yaml",
    );
  });

  it("anchors on the monorepo root, NOT process.cwd() (AUD-002)", () => {
    const resolved = validateManifestPath(".architecture/manifest.yaml");

    assert.equal(resolved, "/fake/repo/.architecture/manifest.yaml");
    assert.doesNotMatch(resolved, /apps\/web/);
  });

  it("accepts a nested path inside .architecture", () => {
    assert.equal(
      validateManifestPath(".architecture/invariants/linter-config.yaml"),
      "/fake/repo/.architecture/invariants/linter-config.yaml",
    );
  });

  it("accepts the .architecture directory itself", () => {
    assert.equal(
      validateManifestPath(".architecture"),
      "/fake/repo/.architecture",
    );
  });

  it("rejects a relative escape", () => {
    assert.throws(() => validateManifestPath("../../etc/passwd"), TRAVERSAL);
  });

  it("rejects an escape that re-enters through .architecture", () => {
    assert.throws(
      () => validateManifestPath(".architecture/../../../etc/passwd"),
      TRAVERSAL,
    );
  });

  it("rejects an absolute path outside the allowed base", () => {
    assert.throws(() => validateManifestPath("/etc/passwd"), TRAVERSAL);
  });

  it("rejects a sibling directory sharing the `.architecture` prefix", () => {
    // The `+ path.sep` in the guard. A bare `startsWith(allowedBase)` would
    // admit this: "/fake/repo/.architecture-attacker/x" starts with
    // "/fake/repo/.architecture".
    assert.throws(
      () => validateManifestPath("../.architecture-attacker/x.yaml"),
      TRAVERSAL,
    );
    assert.throws(
      () => validateManifestPath(".architecture-attacker/x.yaml"),
      TRAVERSAL,
    );
  });

  it("rejects a non-string path instead of letting path.resolve throw", () => {
    assert.throws(
      () => validateManifestPath(42 as unknown as string),
      TRAVERSAL,
    );
    assert.throws(
      () => validateManifestPath({} as unknown as string),
      TRAVERSAL,
    );
  });

  it("propagates a missing anchor as MonorepoRootNotFoundError, not as a traversal error", () => {
    // Callers map the two to different HTTP classes (500 vs 400), so the helper
    // must not flatten a server config failure into a client input error.
    vi.mocked(findMonorepoRoot).mockImplementation(() => {
      throw new MonorepoRootNotFoundError("Could not locate monorepo root");
    });

    assert.throws(
      () => validateManifestPath(".architecture/manifest.yaml"),
      MonorepoRootNotFoundError,
    );
  });
});
