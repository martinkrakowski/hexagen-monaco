import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { StructuredDiffReconciliationAdapter } from "../infrastructure/adapters/structured-diff-reconciliation.adapter.js";
import type { ReconcileRequest } from "../application/ports/in/reconcile.port.js";
import type {
  ProjectSpecLike,
  ArchitectureGraphLike,
} from "../domain/llm-response.js";

describe("StructuredDiffReconciliationAdapter", () => {
  let adapter: StructuredDiffReconciliationAdapter;

  beforeEach(() => {
    adapter = new StructuredDiffReconciliationAdapter();
  });

  const makeRequest = (
    manifest: ProjectSpecLike,
    graph: ArchitectureGraphLike,
    currentManifest: ProjectSpecLike,
  ): ReconcileRequest => ({
    structuredOutput: {
      manifest,
      architectureGraph: graph,
      reasoning: "test",
    },
    currentManifest,
    intentId: "test-intent",
  });

  it("should detect added bounded contexts", async () => {
    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "NewContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [] },
    );

    const result = await adapter.reconcile(request);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.patches.length, 1);
    assert.strictEqual(result.patches[0].type, "add_node");
    assert.strictEqual(result.patches[0].targetId, "bc-1");
  });

  it("should detect removed bounded contexts", async () => {
    const request = makeRequest(
      { boundedContexts: [] },
      { nodes: [], edges: [] },
      { boundedContexts: [{ id: "bc-1", name: "OldContext" }] },
    );

    const result = await adapter.reconcile(request);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.patches.length, 1);
    assert.strictEqual(result.patches[0].type, "remove_node");
    assert.strictEqual(result.patches[0].targetId, "bc-1");
  });

  it("should detect modified bounded contexts", async () => {
    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "RenamedContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [{ id: "bc-1", name: "OldContext" }] },
    );

    const result = await adapter.reconcile(request);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.patches.length, 1);
    assert.strictEqual(result.patches[0].type, "update_node");
    assert.strictEqual(result.patches[0].targetId, "bc-1");
  });

  it("should detect added nodes from graph", async () => {
    const request = makeRequest(
      { boundedContexts: [] },
      {
        nodes: [{ id: "node-1", label: "Test", type: "port", status: "added" }],
        edges: [],
      },
      { boundedContexts: [] },
    );

    const result = await adapter.reconcile(request);

    assert.strictEqual(result.success, true);
    const addPatch = result.patches.find((p) => p.type === "add_node");
    assert.ok(addPatch !== undefined);
    assert.strictEqual(addPatch!.targetId, "node-1");
  });

  it("should detect removed nodes from graph", async () => {
    const request = makeRequest(
      { boundedContexts: [] },
      {
        nodes: [
          { id: "node-1", label: "Test", type: "port", status: "removed" },
        ],
        edges: [],
      },
      { boundedContexts: [] },
    );

    const result = await adapter.reconcile(request);

    assert.strictEqual(result.success, true);
    const removePatch = result.patches.find((p) => p.type === "remove_node");
    assert.ok(removePatch !== undefined);
    assert.strictEqual(removePatch!.targetId, "node-1");
  });

  it("should detect invalid edges and produce remove_edge patches", async () => {
    const request = makeRequest(
      { boundedContexts: [] },
      {
        nodes: [],
        edges: [
          {
            source: "a",
            target: "b",
            relationship: "depends_on",
            isValid: false,
            violationReason: "cross-boundary violation",
          },
        ],
      },
      { boundedContexts: [] },
    );

    const result = await adapter.reconcile(request);

    assert.strictEqual(result.success, true);
    const edgePatch = result.patches.find((p) => p.type === "remove_edge");
    assert.ok(edgePatch !== undefined);
  });

  it("should produce no patches when no differences exist", async () => {
    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "Context" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [{ id: "bc-1", name: "Context" }] },
    );

    const result = await adapter.reconcile(request);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.patches.length, 0);
  });
});
