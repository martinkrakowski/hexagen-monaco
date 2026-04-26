import { ManifestPatchAdapter } from "../infrastructure/adapters/manifest-patch.adapter.js";
import type { Patch, ProjectSpecLike } from "../domain/llm-response.js";

describe("ManifestPatchAdapter", () => {
  let adapter: ManifestPatchAdapter;
  const mockManifest: ProjectSpecLike = {
    boundedContexts: [{ id: "ctx1", name: "Context 1" }],
  };

  beforeEach(() => {
    adapter = new ManifestPatchAdapter();
  });

  describe("validatePatches", () => {
    it("should reject patches with duplicate add_node targetIds", async () => {
      const duplicatePatches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "node-1",
          payload: { label: "Node 1" },
        },
        {
          id: "patch-2",
          type: "add_node",
          targetId: "node-1",
          payload: { label: "Node 1 Duplicate" },
        },
      ];

      const result = await adapter.validatePatches(
        duplicatePatches,
        mockManifest,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Duplicate add_node patch");
        expect(result.error.message).toContain("node-1");
      }
    });

    it("should accept mixed patches with different add_node targetIds", async () => {
      const mixedPatches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "node-1",
          payload: { label: "Node 1" },
        },
        {
          id: "patch-2",
          type: "add_node",
          targetId: "node-2",
          payload: { label: "Node 2" },
        },
        {
          id: "patch-3",
          type: "add_edge",
          targetId: "edge-1",
          payload: { source: "node-1", target: "node-2" },
        },
        {
          id: "patch-4",
          type: "remove_node",
          targetId: "node-3",
          payload: {},
        },
      ];

      const result = await adapter.validatePatches(mixedPatches, mockManifest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual(mixedPatches);
      }
    });

    it("should accept patches with duplicate targetIds if not both add_node", async () => {
      const patchesWithDifferentTypes: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "node-1",
          payload: { label: "Node 1" },
        },
        {
          id: "patch-2",
          type: "update_node",
          targetId: "node-1",
          payload: { label: "Updated" },
        },
      ];

      const result = await adapter.validatePatches(
        patchesWithDifferentTypes,
        mockManifest,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual(patchesWithDifferentTypes);
      }
    });

    it("should accept empty patches array", async () => {
      const result = await adapter.validatePatches([], mockManifest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe("applyPatches", () => {
    it("should return success for applyPatches", async () => {
      const patches: Patch[] = [
        {
          id: "patch-1",
          type: "add_node",
          targetId: "node-1",
          payload: { label: "Node 1" },
        },
      ];

      const result = await adapter.applyPatches(patches, "/path/to/manifest");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeUndefined();
      }
    });

    it("should return success even with empty patches", async () => {
      const result = await adapter.applyPatches([], "/path/to/manifest");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBeUndefined();
      }
    });
  });
});
