import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import type { Patch } from "@hexagen/core-domain";
import type { ManifestMutationPort } from "../../src/application/ports/out/manifest-mutation.port.js";
import type { Manifest } from "@hexagen/sync";
import { SyncDelegatingManifestMutationAdapter } from "../../src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.js";

const createMockSync = () => {
  const saved: Array<{ workspaceRoot: string; manifest: unknown }> = [];
  let currentManifest: Record<string, unknown> = { bounded_contexts: [] };

  const loadManifest = mock.fn(async (_workspaceRoot: string) => ({
    success: true,
    value: JSON.parse(JSON.stringify(currentManifest)) as Manifest,
  }));

  const saveManifest = mock.fn(
    async (workspaceRoot: string, manifest: unknown) => {
      saved.push({ workspaceRoot, manifest });
      currentManifest = JSON.parse(JSON.stringify(manifest)) as Record<
        string,
        unknown
      >;
      return { success: true, value: undefined };
    },
  );

  return {
    loadManifest,
    saveManifest,
    getSavedManifests: () => saved,
    setCurrentManifest: (m: Record<string, unknown>) => {
      currentManifest = m;
    },
    getCurrentManifest: () => currentManifest,
  };
};

describe("Manifest Write-Through - Integration Tests", () => {
  let adapter: SyncDelegatingManifestMutationAdapter;
  let mockSync: ReturnType<typeof createMockSync>;

  beforeEach(() => {
    mockSync = createMockSync();
    adapter = new SyncDelegatingManifestMutationAdapter("/tmp/test-workspace", {
      loadManifest: mockSync.loadManifest,
      saveManifest: mockSync.saveManifest,
    });
  });

  describe("Disk Write Verification (via @hexagen/sync delegation)", () => {
    it("should call loadManifest and saveManifest when applying patches", async () => {
      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "test-context",
          payload: { kind: "core", description: "Test context" },
        },
      ];

      const result = await adapter.applyPatches(
        patches,
        ".architecture/manifest.yaml",
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(
        mockSync.loadManifest.mock.calls[0].arguments[0],
        "/tmp/test-workspace",
      );
      assert.strictEqual(
        mockSync.saveManifest.mock.calls[0].arguments[0],
        "/tmp/test-workspace",
      );
      const savedArg = mockSync.saveManifest.mock.calls[0]
        .arguments[1] as Record<string, unknown>;
      const boundedContexts = savedArg.bounded_contexts as Array<
        Record<string, unknown>
      >;
      assert.ok(boundedContexts.some((c) => c.name === "test-context"));
    });

    it("should persist add_node patch through load → transform → save cycle", async () => {
      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "new-service",
          payload: { kind: "core", description: "New service" },
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      const savedManifest = mockSync.saveManifest.mock.calls[0]
        .arguments[1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<
        Record<string, unknown>
      >;
      assert.strictEqual(contexts.length, 1);
      assert.strictEqual(contexts[0].name, "new-service");
      assert.strictEqual(contexts[0].type, "core");
      assert.strictEqual(contexts[0].description, "New service");
    });

    it("should persist multiple patches in a single load/save cycle", async () => {
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

      assert.strictEqual(mockSync.loadManifest.mock.calls.length, 1);
      assert.strictEqual(mockSync.saveManifest.mock.calls.length, 1);

      const savedManifest = mockSync.saveManifest.mock.calls[0]
        .arguments[1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<
        Record<string, unknown>
      >;
      assert.strictEqual(contexts.length, 2);
      assert.strictEqual(contexts[0].name, "context-a");
      assert.strictEqual(contexts[1].name, "context-b");
    });

    it("should reject duplicate bounded context names without calling saveManifest", async () => {
      mockSync.loadManifest.mock.mockImplementationOnce(async () => ({
        success: true,
        value: {
          bounded_contexts: [
            { name: "existing", type: "core", description: "Existing" },
          ],
        },
      }));

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "existing",
          payload: { kind: "core", description: "Duplicate" },
        },
      ];

      const result = await adapter.applyPatches(
        patches,
        ".architecture/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.message?.includes("already exists"));
      assert.strictEqual(mockSync.saveManifest.mock.calls.length, 0);
    });

    it("should propagate loadManifest failure without calling saveManifest", async () => {
      mockSync.loadManifest.mock.mockImplementationOnce(async () => ({
        success: false,
        error: new Error(".architecture/manifest.yaml not found"),
      }));

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "orphan",
          payload: { kind: "core", description: "Orphan" },
        },
      ];

      const result = await adapter.applyPatches(
        patches,
        ".architecture/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.message?.includes("not found"));
      assert.strictEqual(mockSync.saveManifest.mock.calls.length, 0);
    });
  });

  describe("Patch Type Coverage", () => {
    it("should apply remove_node patch through save cycle", async () => {
      mockSync.loadManifest.mock.mockImplementationOnce(async () => ({
        success: true,
        value: {
          bounded_contexts: [
            { name: "keep-me", type: "core", description: "Keep" },
            { name: "remove-me", type: "supporting", description: "Remove" },
          ],
        },
      }));

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "remove_node",
          targetId: "remove-me",
          payload: {},
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      const savedManifest = mockSync.saveManifest.mock.calls[0]
        .arguments[1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<
        Record<string, unknown>
      >;
      assert.strictEqual(contexts.length, 1);
      assert.strictEqual(contexts[0].name, "keep-me");
    });

    it("should apply update_node patch through save cycle", async () => {
      mockSync.loadManifest.mock.mockImplementationOnce(async () => ({
        success: true,
        value: {
          bounded_contexts: [
            { name: "update-me", type: "core", description: "Original" },
          ],
        },
      }));

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "update_node",
          targetId: "update-me",
          payload: { description: "Updated" },
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      const savedManifest = mockSync.saveManifest.mock.calls[0]
        .arguments[1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<
        Record<string, unknown>
      >;
      assert.strictEqual(contexts[0].description, "Updated");
    });

    it("should apply add_edge patch through save cycle", async () => {
      mockSync.loadManifest.mock.mockImplementationOnce(async () => ({
        success: true,
        value: {
          bounded_contexts: [
            { name: "source-ctx", type: "core", description: "Source" },
            {
              name: "target-ctx",
              type: "supporting",
              description: "Target",
            },
          ],
        },
      }));

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_edge",
          targetId: "edge-1",
          payload: { source: "source-ctx", target: "target-ctx" },
        },
      ];

      await adapter.applyPatches(patches, ".architecture/manifest.yaml");

      const savedManifest = mockSync.saveManifest.mock.calls[0]
        .arguments[1] as Record<string, unknown>;
      const contexts = savedManifest.bounded_contexts as Array<
        Record<string, unknown>
      >;
      const sourceCtx = contexts.find((c) => c.name === "source-ctx");
      assert.ok(
        (sourceCtx?.depends_on as unknown as string[])?.includes("target-ctx"),
      );
    });
  });

  describe("Wire Configuration Regression Guard", () => {
    it("should be a ManifestMutationPort implementation (not a NO-OP)", () => {
      const adapterInstance: ManifestMutationPort =
        new SyncDelegatingManifestMutationAdapter("/test");

      assert.ok(adapterInstance !== undefined);
      assert.strictEqual(typeof adapterInstance.applyPatches, "function");
      assert.strictEqual(typeof adapterInstance.restoreFromGit, "function");
      assert.strictEqual(
        adapterInstance.constructor.name,
        "SyncDelegatingManifestMutationAdapter",
      );
    });

    it("should NOT be InMemoryManifestMutationAdapter", () => {
      const adapterInstance = new SyncDelegatingManifestMutationAdapter(
        "/test",
      );

      assert.notStrictEqual(
        adapterInstance.constructor.name,
        "InMemoryManifestMutationAdapter",
      );
    });

    it("should require workspaceRoot constructor argument (not parameterless like the NO-OP)", () => {
      assert.strictEqual(SyncDelegatingManifestMutationAdapter.length, 1);
    });
  });

  describe("Error Propagation", () => {
    it("should propagate saveManifest failure as error result", async () => {
      mockSync.saveManifest.mock.mockImplementationOnce(async () => ({
        success: false,
        error: new Error("disk full"),
      }));

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "fail-write",
          payload: { kind: "core", description: "Fail" },
        },
      ];

      const result = await adapter.applyPatches(
        patches,
        ".architecture/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.message, "disk full");
    });

    it("should catch unexpected exceptions and return error result", async () => {
      mockSync.loadManifest.mock.mockImplementationOnce(async () => {
        throw new Error("unexpected crash");
      });

      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "crash",
          payload: { kind: "core", description: "Crash" },
        },
      ];

      const result = await adapter.applyPatches(
        patches,
        ".architecture/manifest.yaml",
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.message, "unexpected crash");
    });
  });
});
