/**
 * Integration test: Manifest Write-Through
 *
 * Validates that SyncDelegatingManifestMutationAdapter actually reads
 * from and writes to the filesystem via @hexagen/sync, preventing
 * regression to the NO-OP InMemoryManifestMutationAdapter that caused
 * Blocker 1.
 *
 * Strategy:
 * - Disk I/O tests mock @hexagen/sync to capture load/save calls,
 *   verifying the adapter delegates correctly rather than being a NO-OP.
 * - Wire configuration tests assert the production wiring uses
 *   SyncDelegatingManifestMutationAdapter (type-level regression guard).
 */

import type { Patch } from "@hexagen/core-domain";
import type { Result } from "../../src/application/result.js";
import type { ManifestMutationPort } from "../../src/application/ports/out/manifest-mutation.port.js";

const createMockSync = () => {
  const saved: Array<{ workspaceRoot: string; manifest: unknown }> = [];
  let currentManifest: Record<string, unknown> = { bounded_contexts: [] };

  return {
    loadManifest: jest.fn().mockImplementation(async (_workspaceRoot: string) => ({
      success: true,
      value: JSON.parse(JSON.stringify(currentManifest)),
    })),
    saveManifest: jest.fn().mockImplementation(async (workspaceRoot: string, manifest: unknown) => {
      saved.push({ workspaceRoot, manifest });
      currentManifest = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
      return { success: true, value: undefined };
    }),
    getSavedManifests: () => saved,
    setCurrentManifest: (m: Record<string, unknown>) => {
      currentManifest = m;
    },
    getCurrentManifest: () => currentManifest,
  };
};

jest.mock("@hexagen/sync", () => {
  const mockSync = createMockSync();
  return {
    __esModule: true,
    loadManifest: mockSync.loadManifest,
    saveManifest: mockSync.saveManifest,
    _mockSync: mockSync,
  };
});

import { SyncDelegatingManifestMutationAdapter } from "../../src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.js";

describe("Manifest Write-Through - Integration Tests", () => {
  let adapter: SyncDelegatingManifestMutationAdapter;

  beforeEach(() => {
    const mockSync = createMockSync();
    (jest.requireMock("@hexagen/sync") as Record<string, unknown>)._mockSync = mockSync;
    jest.mocked(
      require("@hexagen/sync").loadManifest,
    ).mockImplementation(mockSync.loadManifest);
    jest.mocked(
      require("@hexagen/sync").saveManifest,
    ).mockImplementation(mockSync.saveManifest);
    adapter = new SyncDelegatingManifestMutationAdapter("/tmp/test-workspace");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Disk Write Verification (via @hexagen/sync delegation)", () => {
    it("should call loadManifest and saveManifest when applying patches", async () => {
      const { loadManifest, saveManifest } = require("@hexagen/sync");

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "test-context",
          payload: { kind: "core", description: "Test context" },
        },
      ];

      const result = await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      expect(result.success).toBe(true);
      expect(loadManifest).toHaveBeenCalledWith("/tmp/test-workspace");
      expect(saveManifest).toHaveBeenCalledWith(
        "/tmp/test-workspace",
        expect.objectContaining({
          bounded_contexts: expect.arrayContaining([
            expect.objectContaining({ name: "test-context" }),
          ]),
        }),
      );
    });

    it("should persist add_node patch through load → transform → save cycle", async () => {
      const { saveManifest } = require("@hexagen/sync");

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "new-service",
          payload: { kind: "core", description: "New service" },
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      const savedManifest = saveManifest.mock.calls[0][1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<Record<string, unknown>>;
      expect(contexts).toHaveLength(1);
      expect(contexts[0].name).toBe("new-service");
      expect(contexts[0].type).toBe("core");
      expect(contexts[0].description).toBe("New service");
    });

    it("should persist multiple patches in a single load/save cycle", async () => {
      const { loadManifest, saveManifest } = require("@hexagen/sync");

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "context-a",
          payload: { kind: "core", description: "Context A" },
        },
        {
          id: "patch-2",
          type: "add_node",
          targetId: "context-b",
          payload: { kind: "supporting", description: "Context B" },
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      expect(loadManifest).toHaveBeenCalledTimes(1);
      expect(saveManifest).toHaveBeenCalledTimes(1);

      const savedManifest = saveManifest.mock.calls[0][1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<Record<string, unknown>>;
      expect(contexts).toHaveLength(2);
      expect(contexts[0].name).toBe("context-a");
      expect(contexts[1].name).toBe("context-b");
    });

    it("should reject duplicate bounded context names without calling saveManifest", async () => {
      const { loadManifest, saveManifest } = require("@hexagen/sync");

      (loadManifest as jest.Mock).mockResolvedValueOnce({
        success: true,
        value: { bounded_contexts: [{ name: "existing", type: "core", description: "Existing" }] },
      });

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "existing",
          payload: { kind: "core", description: "Duplicate" },
        },
      ];

      const result = await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("already exists");
      expect(saveManifest).not.toHaveBeenCalled();
    });

    it("should propagate loadManifest failure without calling saveManifest", async () => {
      const { loadManifest, saveManifest } = require("@hexagen/sync");

      (loadManifest as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: new Error(".architecture/manifest.yaml not found"),
      });

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "orphan",
          payload: { kind: "core", description: "Orphan" },
        },
      ];

      const result = await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("not found");
      expect(saveManifest).not.toHaveBeenCalled();
    });
  });

  describe("Patch Type Coverage", () => {
    it("should apply remove_node patch through save cycle", async () => {
      const { loadManifest, saveManifest } = require("@hexagen/sync");

      (loadManifest as jest.Mock).mockResolvedValueOnce({
        success: true,
        value: {
          bounded_contexts: [
            { name: "keep-me", type: "core", description: "Keep" },
            { name: "remove-me", type: "supporting", description: "Remove" },
          ],
        },
      });

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "remove_node",
          targetId: "remove-me",
          payload: {},
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      const savedManifest = saveManifest.mock.calls[0][1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<Record<string, unknown>>;
      expect(contexts).toHaveLength(1);
      expect(contexts[0].name).toBe("keep-me");
    });

    it("should apply update_node patch through save cycle", async () => {
      const { loadManifest, saveManifest } = require("@hexagen/sync");

      (loadManifest as jest.Mock).mockResolvedValueOnce({
        success: true,
        value: {
          bounded_contexts: [{ name: "update-me", type: "core", description: "Original" }],
        },
      });

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "update_node",
          targetId: "update-me",
          payload: { description: "Updated" },
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      const savedManifest = saveManifest.mock.calls[0][1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<Record<string, unknown>>;
      expect(contexts[0].description).toBe("Updated");
    });

    it("should apply add_edge patch through save cycle", async () => {
      const { loadManifest, saveManifest } = require("@hexagen/sync");

      (loadManifest as jest.Mock).mockResolvedValueOnce({
        success: true,
        value: {
          bounded_contexts: [
            { name: "source-ctx", type: "core", description: "Source" },
            { name: "target-ctx", type: "supporting", description: "Target" },
          ],
        },
      });

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_edge",
          targetId: "edge-1",
          payload: { source: "source-ctx", target: "target-ctx" },
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      const savedManifest = saveManifest.mock.calls[0][1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<Record<string, unknown>>;
      const sourceCtx = contexts.find((c) => c.name === "source-ctx");
      expect(sourceCtx?.depends_on).toContain("target-ctx");
    });
  });

  describe("Wire Configuration Regression Guard", () => {
    it("should be a ManifestMutationPort implementation (not a NO-OP)", () => {
      const adapterInstance: ManifestMutationPort =
        new SyncDelegatingManifestMutationAdapter("/test");

      expect(adapterInstance).toBeDefined();
      expect(typeof adapterInstance.applyPatches).toBe("function");
      expect(typeof adapterInstance.restoreFromGit).toBe("function");
      expect(adapterInstance.constructor.name).toBe(
        "SyncDelegatingManifestMutationAdapter",
      );
    });

    it("should NOT be InMemoryManifestMutationAdapter", () => {
      const adapterInstance =
        new SyncDelegatingManifestMutationAdapter("/test");

      expect(adapterInstance.constructor.name).not.toBe(
        "InMemoryManifestMutationAdapter",
      );
    });

    it("should require workspaceRoot constructor argument (not parameterless like the NO-OP)", () => {
      expect(SyncDelegatingManifestMutationAdapter.length).toBe(1);
    });
  });

  describe("Error Propagation", () => {
    it("should propagate saveManifest failure as error result", async () => {
      const { saveManifest } = require("@hexagen/sync");

      (saveManifest as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: new Error("disk full"),
      });

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "fail-write",
          payload: { kind: "core", description: "Fail" },
        },
      ];

      const result = await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("disk full");
    });

    it("should catch unexpected exceptions and return error result", async () => {
      const { loadManifest } = require("@hexagen/sync");

      (loadManifest as jest.Mock).mockRejectedValueOnce(
        new Error("unexpected crash"),
      );

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "crash",
          payload: { kind: "core", description: "Crash" },
        },
      ];

      const result = await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("unexpected crash");
    });
  });
});
