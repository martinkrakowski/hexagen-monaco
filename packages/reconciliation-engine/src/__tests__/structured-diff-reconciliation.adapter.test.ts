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

    expect(result.success).toBe(true);
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0].type).toBe("add_node");
    expect(result.patches[0].targetId).toBe("bc-1");
  });

  it("should detect removed bounded contexts", async () => {
    const request = makeRequest(
      { boundedContexts: [] },
      { nodes: [], edges: [] },
      { boundedContexts: [{ id: "bc-1", name: "OldContext" }] },
    );

    const result = await adapter.reconcile(request);

    expect(result.success).toBe(true);
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0].type).toBe("remove_node");
    expect(result.patches[0].targetId).toBe("bc-1");
  });

  it("should detect modified bounded contexts", async () => {
    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "RenamedContext" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [{ id: "bc-1", name: "OldContext" }] },
    );

    const result = await adapter.reconcile(request);

    expect(result.success).toBe(true);
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0].type).toBe("update_node");
    expect(result.patches[0].targetId).toBe("bc-1");
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

    expect(result.success).toBe(true);
    const addPatch = result.patches.find((p) => p.type === "add_node");
    expect(addPatch).toBeDefined();
    expect(addPatch!.targetId).toBe("node-1");
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

    expect(result.success).toBe(true);
    const removePatch = result.patches.find((p) => p.type === "remove_node");
    expect(removePatch).toBeDefined();
    expect(removePatch!.targetId).toBe("node-1");
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

    expect(result.success).toBe(true);
    const edgePatch = result.patches.find((p) => p.type === "remove_edge");
    expect(edgePatch).toBeDefined();
  });

  it("should produce no patches when no differences exist", async () => {
    const request = makeRequest(
      { boundedContexts: [{ id: "bc-1", name: "Context" }] },
      { nodes: [], edges: [] },
      { boundedContexts: [{ id: "bc-1", name: "Context" }] },
    );

    const result = await adapter.reconcile(request);

    expect(result.success).toBe(true);
    expect(result.patches).toHaveLength(0);
  });
});
