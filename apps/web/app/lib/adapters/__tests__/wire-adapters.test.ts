import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";

// The read-only display providers must resolve the manifest against the shared
// monorepo-root anchor, not process.cwd() (apps/web under the standalone build).
// Mock the anchor + the manifest reader so we can assert which workspace root
// the providers hand to mergeSplitManifest.
vi.mock("../../monorepo-root", () => ({
  findMonorepoRoot: vi.fn(),
}));
vi.mock("@hexagen/project-configuration/server", () => ({
  mergeSplitManifest: vi.fn(),
}));

import {
  ManifestProviderAdapter,
  ServerArchitectureGraphProviderAdapter,
} from "../wire-adapters";
import { findMonorepoRoot } from "../../monorepo-root";
import { mergeSplitManifest } from "@hexagen/project-configuration/server";

describe("wire-adapters manifest-path anchoring", () => {
  beforeEach(() => {
    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");
    // Simulate prod cwd ≠ monorepo root.
    vi.spyOn(process, "cwd").mockReturnValue("/fake/repo/apps/web");
    vi.mocked(mergeSplitManifest).mockResolvedValue({
      bounded_contexts: [],
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(mergeSplitManifest).mockReset();
  });

  it("ManifestProviderAdapter reads from the monorepo-root anchor, not process.cwd()", async () => {
    await new ManifestProviderAdapter().getManifest();

    assert.equal(vi.mocked(mergeSplitManifest).mock.calls.length, 1);
    const [workspaceRoot, manifestPath] =
      vi.mocked(mergeSplitManifest).mock.calls[0];
    assert.equal(workspaceRoot, "/fake/repo");
    assert.equal(manifestPath, "/fake/repo/.architecture/manifest.yaml");
  });

  it("ServerArchitectureGraphProviderAdapter reads from the monorepo-root anchor, not process.cwd()", async () => {
    await new ServerArchitectureGraphProviderAdapter().getArchitectureGraph(
      "proj-1",
    );

    assert.equal(vi.mocked(mergeSplitManifest).mock.calls.length, 1);
    const [workspaceRoot, manifestPath] =
      vi.mocked(mergeSplitManifest).mock.calls[0];
    assert.equal(workspaceRoot, "/fake/repo");
    assert.equal(manifestPath, "/fake/repo/.architecture/manifest.yaml");
  });
});
