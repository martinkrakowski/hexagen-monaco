import {
  createPatch,
  createReconciliationResult,
} from "../../src/domain/llm-response.js";

describe("createPatch", () => {
  it("should create a patch with unique id", () => {
    const p1 = createPatch("add_node", "node-1", { kind: "Entity" });
    const p2 = createPatch("add_node", "node-2", { kind: "Aggregate" });

    expect(p1.id).not.toBe(p2.id);
    expect(p1.id).toMatch(/^patch-/);
  });

  it("should create a patch with correct type and target", () => {
    const patch = createPatch("remove_node", "node-1", {});

    expect(patch.type).toBe("remove_node");
    expect(patch.targetId).toBe("node-1");
    expect(patch.payload).toEqual({});
  });
});

describe("createReconciliationResult", () => {
  it("should create a successful result with default summary", () => {
    const result = createReconciliationResult(true);

    expect(result.success).toBe(true);
    expect(result.patches).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.summary).toBe("Reconciliation completed");
  });

  it("should create a failed result with default summary", () => {
    const result = createReconciliationResult(false, [], ["error"]);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(["error"]);
    expect(result.summary).toBe("Reconciliation failed");
  });

  it("should use custom summary when provided", () => {
    const result = createReconciliationResult(true, [], [], "Custom summary");

    expect(result.summary).toBe("Custom summary");
  });

  it("should include patches", () => {
    const patch = createPatch("add_node", "node-1", { kind: "Entity" });
    const result = createReconciliationResult(true, [patch]);

    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]).toEqual(patch);
  });
});