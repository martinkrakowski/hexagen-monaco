import { DefaultConflictResolverAdapter } from "../../../src/infrastructure/adapters/default-conflict-resolver.adapter.js";
import type { ResolveConflictPort } from "../../../src/application/ports/in/resolve-conflict.port.js";
import type { Patch } from "../../../src/domain/llm-response.js";

describe("DefaultConflictResolverAdapter", () => {
  let adapter: ResolveConflictPort;

  beforeEach(() => {
    adapter = new DefaultConflictResolverAdapter();
  });

  describe("resolveConflict", () => {
    it("should prefer the patch with the later timestamp", () => {
      const patchA: Patch = {
        id: "patch-1000-abc",
        type: "add_node",
        targetId: "node-1",
        payload: { kind: "Entity" },
      };
      const patchB: Patch = {
        id: "patch-2000-def",
        type: "remove_node",
        targetId: "node-2",
        payload: {},
      };

      const result = adapter.resolveConflict(patchA, patchB);
      expect(result).toBe(patchB); // patchB has later timestamp (2000 > 1000)
    });

    it("should prefer the patch with the earlier timestamp when reversed", () => {
      const patchA: Patch = {
        id: "patch-2000-abc",
        type: "add_node",
        targetId: "node-1",
        payload: { kind: "Entity" },
      };
      const patchB: Patch = {
        id: "patch-1000-def",
        type: "remove_node",
        targetId: "node-2",
        payload: {},
      };

      const result = adapter.resolveConflict(patchA, patchB);
      expect(result).toBe(patchA); // patchA has later timestamp (2000 > 1000)
    });

    it("should use ID for tie-breaking when timestamps are equal", () => {
      const patchA: Patch = {
        id: "patch-1000-z",
        type: "add_node",
        targetId: "node-1",
        payload: { kind: "Entity" },
      };
      const patchB: Patch = {
        id: "patch-1000-a",
        type: "remove_node",
        targetId: "node-2",
        payload: {},
      };

      const result = adapter.resolveConflict(patchA, patchB);
      expect(result).toBe(patchA); // 'z' > 'a' lexicographically

      const result2 = adapter.resolveConflict(patchB, patchA);
      expect(result2).toBe(patchA); // Still patchA wins
    });

    it("should return patchA when IDs are identical (fallback)", () => {
      const patchA: Patch = {
        id: "patch-1000-same",
        type: "add_node",
        targetId: "node-1",
        payload: { kind: "Entity" },
      };
      const patchB: Patch = {
        id: "patch-1000-same", // Same ID - should not happen in practice
        type: "remove_node",
        targetId: "node-2",
        payload: {},
      };

      const result = adapter.resolveConflict(patchA, patchB);
      expect(result).toBe(patchA); // Fallback to patchA
    });

    it("should work with different patch types", () => {
      const patchA: Patch = {
        id: "patch-1500-aaa",
        type: "update_node",
        targetId: "node-1",
        payload: { kind: "UpdatedEntity" },
      };
      const patchB: Patch = {
        id: "patch-1500-aab",
        type: "add_edge",
        targetId: "edge-1",
        payload: { source: "node-1", target: "node-2" },
      };

      const result = adapter.resolveConflict(patchA, patchB);
      expect(result).toBe(patchB); // 'aab' > 'aaa' lexicographically
    });
  });
});
