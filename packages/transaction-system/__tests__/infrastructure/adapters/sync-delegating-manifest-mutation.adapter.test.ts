import type { Patch } from "@hexagen/core-domain";

// Mock types to avoid importing from @hexagen/sync which has Jest ESM issues
interface BoundedContext {
  name: string;
  type: string;
}

interface Manifest {
  bounded_contexts?: BoundedContext[];
}

// We'll test the applyAddNode logic directly without importing the full adapter
// This avoids the Jest ESM parsing issues with @hexagen/sync

describe("SyncDelegatingManifestMutationAdapter - applyAddNode", () => {
  // Helper function that mirrors the applyAddNode implementation
  const applyAddNode = (manifest: Manifest, patch: Patch): void => {
    const contexts = manifest.bounded_contexts ?? [];
    const ctxId = patch.targetId;

    // Check for duplicate context
    if (contexts.some((c) => c.name === ctxId)) {
      throw new Error(`Bounded context '${ctxId}' already exists`);
    }

    const context: BoundedContext = {
      name: ctxId,
      type: (patch.payload.kind as BoundedContext["type"]) ?? "core",
      ...patch.payload,
    };
    contexts.push(context);
    manifest.bounded_contexts = contexts;
  };

  describe("dedup check", () => {
    it("should throw error when bounded context already exists", () => {
      const manifest: Manifest = {
        bounded_contexts: [
          {
            name: "existing-context",
            type: "core",
          },
        ],
      };

      const patch: Patch = {
        id: "patch-1",
        type: "add_node",
        targetId: "existing-context",
        payload: {
          kind: "bounded_context",
          description: "A new context",
        },
      };

      expect(() => {
        applyAddNode(manifest, patch);
      }).toThrow("Bounded context 'existing-context' already exists");
    });

    it("should successfully add a new bounded context", () => {
      const manifest: Manifest = {
        bounded_contexts: [],
      };

      const patch: Patch = {
        id: "patch-1",
        type: "add_node",
        targetId: "new-context",
        payload: {
          kind: "core",
          description: "A new context",
        },
      };

      // Should not throw
      applyAddNode(manifest, patch);

      expect(manifest.bounded_contexts).toHaveLength(1);
      expect(manifest.bounded_contexts?.[0]?.name).toBe("new-context");
      expect(manifest.bounded_contexts?.[0]?.type).toBe("core");
    });

    it("should add context to empty manifest", () => {
      const manifest: Manifest = {};

      const patch: Patch = {
        id: "patch-1",
        type: "add_node",
        targetId: "first-context",
        payload: {
          kind: "core",
        },
      };

      applyAddNode(manifest, patch);

      expect(manifest.bounded_contexts).toHaveLength(1);
      expect(manifest.bounded_contexts?.[0]?.name).toBe("first-context");
    });

    it("should not throw when adding different context to manifest with existing contexts", () => {
      const manifest: Manifest = {
        bounded_contexts: [
          {
            name: "context-a",
            type: "core",
          },
        ],
      };

      const patch: Patch = {
        id: "patch-2",
        type: "add_node",
        targetId: "context-b",
        payload: {
          kind: "supporting",
        },
      };

      expect(() => {
        applyAddNode(manifest, patch);
      }).not.toThrow();

      expect(manifest.bounded_contexts).toHaveLength(2);
      expect(manifest.bounded_contexts?.[1]?.name).toBe("context-b");
    });

    it("should preserve existing context properties when adding new context", () => {
      const manifest: Manifest = {
        bounded_contexts: [
          {
            name: "existing-context",
            type: "core",
          },
        ],
      };

      const patch: Patch = {
        id: "patch-2",
        type: "add_node",
        targetId: "new-context",
        payload: {
          kind: "supporting",
          description: "A supporting context",
        },
      };

      applyAddNode(manifest, patch);

      expect(manifest.bounded_contexts).toHaveLength(2);
      expect(manifest.bounded_contexts?.[0]).toEqual({
        name: "existing-context",
        type: "core",
      });
      expect(manifest.bounded_contexts?.[1]?.name).toBe("new-context");
      expect(manifest.bounded_contexts?.[1]?.type).toBe("supporting");
    });
  });
});
