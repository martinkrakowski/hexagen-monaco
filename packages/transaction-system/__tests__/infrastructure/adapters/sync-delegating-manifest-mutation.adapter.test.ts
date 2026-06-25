import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Patch } from "@hexagen/core-domain";

interface BoundedContext {
  name: string;
  type: string;
}

interface Manifest {
  bounded_contexts?: BoundedContext[];
}

describe("SyncDelegatingManifestMutationAdapter - applyAddNode", () => {
  const applyAddNode = (manifest: Manifest, patch: Patch): void => {
    const contexts = manifest.bounded_contexts ?? [];
    const ctxId = patch.targetId;

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

      assert.throws(() => {
        applyAddNode(manifest, patch);
      }, /Bounded context 'existing-context' already exists/);
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

      applyAddNode(manifest, patch);

      assert.strictEqual(manifest.bounded_contexts!.length, 1);
      assert.strictEqual(manifest.bounded_contexts?.[0]?.name, "new-context");
      assert.strictEqual(manifest.bounded_contexts?.[0]?.type, "core");
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

      assert.strictEqual(manifest.bounded_contexts!.length, 1);
      assert.strictEqual(manifest.bounded_contexts?.[0]?.name, "first-context");
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

      assert.doesNotThrow(() => {
        applyAddNode(manifest, patch);
      });

      assert.strictEqual(manifest.bounded_contexts!.length, 2);
      assert.strictEqual(manifest.bounded_contexts?.[1]?.name, "context-b");
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

      assert.strictEqual(manifest.bounded_contexts!.length, 2);
      assert.deepStrictEqual(manifest.bounded_contexts?.[0], {
        name: "existing-context",
        type: "core",
      });
      assert.strictEqual(manifest.bounded_contexts?.[1]?.name, "new-context");
      assert.strictEqual(manifest.bounded_contexts?.[1]?.type, "supporting");
    });
  });
});
