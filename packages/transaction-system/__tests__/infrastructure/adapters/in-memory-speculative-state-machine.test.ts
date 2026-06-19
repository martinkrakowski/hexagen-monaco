import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { InMemorySpeculativeStateMachine } from "../../../src/infrastructure/adapters/in-memory-speculative-state-machine.adapter.js";
import type { DomainAST } from "@hexagen/core-domain";

import { NodeKind } from "@hexagen/core-domain";

const makeAst = (): DomainAST => ({
  nodes: [
    { id: "node-1", kind: NodeKind.Aggregate, attributes: { label: "Order" } },
  ],
  edges: [],
  invariants: { topology: [], cardinality: [] },
});

describe("InMemorySpeculativeStateMachine", () => {
  let stateMachine: InMemorySpeculativeStateMachine;

  beforeEach(() => {
    stateMachine = new InMemorySpeculativeStateMachine();
  });

  describe("applySpeculative()", () => {
    it("should apply a speculative mutation and return a snapshot id", () => {
      const ast = makeAst();
      const mutation = { type: "add_node" };
      const snapshotId = stateMachine.applySpeculative(ast, mutation);

      assert.ok(snapshotId !== undefined);
      assert.strictEqual(typeof snapshotId, "string");
    });

    it("should generate unique snapshot ids", () => {
      const ast = makeAst();
      const id1 = stateMachine.applySpeculative(ast, {});
      const id2 = stateMachine.applySpeculative(ast, {});

      assert.notStrictEqual(id1, id2);
    });
  });

  describe("commitSpeculative()", () => {
    it("should commit a speculative snapshot", () => {
      const ast = makeAst();
      const snapshotId = stateMachine.applySpeculative(ast, {});

      const result = stateMachine.commitSpeculative(snapshotId);

      assert.strictEqual(result, true);
    });

    it("should return false for non-existent snapshot", () => {
      const result = stateMachine.commitSpeculative("non-existent");

      assert.strictEqual(result, false);
    });
  });

  describe("rollbackSpeculative()", () => {
    it("should rollback and remove a speculative snapshot", () => {
      const ast = makeAst();
      const snapshotId = stateMachine.applySpeculative(ast, {});

      const result = stateMachine.rollbackSpeculative(snapshotId);

      assert.strictEqual(result, true);
      assert.strictEqual(stateMachine.getSpeculativeState(snapshotId), null);
    });

    it("should return false for non-existent snapshot", () => {
      const result = stateMachine.rollbackSpeculative("non-existent");

      assert.strictEqual(result, false);
    });
  });

  describe("getSpeculativeState()", () => {
    it("should return the speculative AST state", () => {
      const ast = makeAst();
      const mutation = { type: "add_node" };
      const snapshotId = stateMachine.applySpeculative(ast, mutation);

      const state = stateMachine.getSpeculativeState(snapshotId);

      assert.ok(state !== undefined);
      assert.strictEqual(state!.nodes[0].id, "node-1");
    });

    it("should return null for non-existent snapshot", () => {
      const state = stateMachine.getSpeculativeState("non-existent");

      assert.strictEqual(state, null);
    });

    it("should not mutate the original AST", () => {
      const ast = makeAst();
      const originalNodeCount = ast.nodes.length;
      stateMachine.applySpeculative(ast, { type: "add_node" });

      assert.strictEqual(ast.nodes.length, originalNodeCount);
    });
  });
});
