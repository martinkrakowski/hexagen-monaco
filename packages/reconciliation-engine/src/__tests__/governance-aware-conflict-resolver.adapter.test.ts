import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { GovernanceAwareConflictResolverAdapter } from "../infrastructure/adapters/governance-aware-conflict-resolver.adapter.js";
import { createPatch } from "../domain/llm-response.js";

describe("GovernanceAwareConflictResolverAdapter", () => {
  let resolver: GovernanceAwareConflictResolverAdapter;

  beforeEach(() => {
    resolver = new GovernanceAwareConflictResolverAdapter();
  });

  it("should prefer non-destructive patch over destructive one", () => {
    const addPatch = createPatch("add_node", "bc-1", { name: "New" });
    const removePatch = createPatch("remove_node", "bc-2", { name: "Old" });

    const result = resolver.resolveConflict(addPatch, removePatch);
    assert.strictEqual(result.type, "add_node");
  });

  it("should prefer patch targeting governance-critical ID", () => {
    const governancePatch = createPatch("update_node", "shared-kernel", {
      change: "governance",
    });
    const normalPatch = createPatch("update_node", "bc-1", {
      change: "normal",
    });

    const result = resolver.resolveConflict(governancePatch, normalPatch);
    assert.strictEqual(result.targetId, "shared-kernel");
  });

  it("should prefer invariant-preserving patch when types differ", () => {
    const addPatch = createPatch("add_edge", "edge-1", {
      source: "a",
      target: "b",
    });
    const removePatch = createPatch("remove_edge", "edge-2", {
      source: "c",
      target: "d",
    });

    const result = resolver.resolveConflict(addPatch, removePatch);
    assert.strictEqual(result.type, "add_edge");
  });

  it("should prefer first patch when both are equally prioritized", () => {
    const patchA = createPatch("add_node", "bc-1", { name: "A" });
    const patchB = createPatch("add_node", "bc-2", { name: "B" });

    const result = resolver.resolveConflict(patchA, patchB);
    assert.strictEqual(result.id, patchA.id);
  });

  it("should protect governance target over non-governance destructive patch", () => {
    const destructiveGovernance = createPatch("remove_node", "governance", {
      change: "risky",
    });
    const destructiveNormal = createPatch("remove_node", "bc-1", {
      change: "also-risky",
    });

    const result = resolver.resolveConflict(
      destructiveGovernance,
      destructiveNormal,
    );
    assert.strictEqual(result.targetId, "governance");
  });
});
