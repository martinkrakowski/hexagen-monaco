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

const log = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../../../../lib/structured-logger", () => ({
  logger: { warn: log.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  ManifestProviderAdapter,
  ServerArchitectureGraphProviderAdapter,
  ServerMergedManifestProviderAdapter,
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

  // The third provider joined the file with HEX-034 and reads the SAME document
  // the two above do. It is anchored here for the same reason they are: three
  // hand-copied anchors is how the AUD-002 fix drifts back out, and the shared
  // `readMergedManifest` helper they now go through has to keep all three right.
  it("ServerMergedManifestProviderAdapter reads from the monorepo-root anchor, not process.cwd()", async () => {
    await new ServerMergedManifestProviderAdapter().getMergedManifest();

    assert.equal(vi.mocked(mergeSplitManifest).mock.calls.length, 1);
    const [workspaceRoot, manifestPath] =
      vi.mocked(mergeSplitManifest).mock.calls[0];
    assert.equal(workspaceRoot, "/fake/repo");
    assert.equal(manifestPath, "/fake/repo/.architecture/manifest.yaml");
  });
});

describe("wire-adapters degradation postures", () => {
  beforeEach(() => {
    log.warn.mockClear();
    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(mergeSplitManifest).mockReset();
  });

  it("returns the merged document the loader produced, and logs nothing", async () => {
    const doc = { system: "s", bounded_contexts: [] };
    vi.mocked(mergeSplitManifest).mockResolvedValue(doc as never);

    const result =
      await new ServerMergedManifestProviderAdapter().getMergedManifest();

    assert.equal(result, doc);
    assert.equal(log.warn.mock.calls.length, 0);
  });

  it("a failed merge degrades to null AND leaves the cause in the log", async () => {
    // Without the log an operator sees only an empty governance panel: the
    // consuming route turns this null into an empty 200. mergeSplitManifest
    // throws distinct, actionable errors (unsupported schema version, missing
    // context file, missing workspace-config side-car, validation failure).
    vi.mocked(mergeSplitManifest).mockRejectedValue(
      new Error("unsupported schema version 9"),
    );

    const result =
      await new ServerMergedManifestProviderAdapter().getMergedManifest();

    assert.equal(result, null);
    assert.equal(log.warn.mock.calls.length, 1);
    const [message, meta] = log.warn.mock.calls[0] as [
      string,
      { error: Error },
    ];
    assert.match(message, /merged manifest/i);
    assert.equal(meta.error.message, "unsupported schema version 9");
  });

  it("a root-discovery failure degrades the same way", async () => {
    vi.mocked(findMonorepoRoot).mockImplementation(() => {
      throw new Error("MonorepoRootNotFoundError");
    });

    const result =
      await new ServerMergedManifestProviderAdapter().getMergedManifest();

    assert.equal(result, null);
    assert.equal(log.warn.mock.calls.length, 1);
  });

  it("the sibling providers keep their own, different postures on the same failure", async () => {
    vi.mocked(mergeSplitManifest).mockRejectedValue(new Error("boom"));

    // An empty context list — not null, not a rejection.
    assert.deepEqual(await new ManifestProviderAdapter().getManifest(), {
      boundedContexts: [],
    });

    // An err Result — not an empty graph.
    const graph =
      await new ServerArchitectureGraphProviderAdapter().getArchitectureGraph(
        "proj-1",
      );
    assert.equal(graph.success, false);
  });
});
