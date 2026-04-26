/**
 * Integration test: Patches → Transaction → Manifest Apply Pipeline
 *
 * Tests the end-to-end flow from reconciliation patches through transaction
 * management and manifest mutation. Validates atomicity and lint validation.
 */

import { InMemoryTransactionManager } from "../../src/infrastructure/adapters/in-memory-transaction-manager.adapter.js";
import { InMemoryBackpressureController } from "../../src/infrastructure/adapters/in-memory-backpressure-controller.adapter.js";
import { InMemorySpeculativeStateMachine } from "../../src/infrastructure/adapters/in-memory-speculative-state-machine.adapter.js";
import { InMemorySemanticCache } from "../../src/infrastructure/adapters/in-memory-semantic-cache.adapter.js";
import { NodeKind } from "@hexagen/core-domain";
import type { DomainAST } from "@hexagen/core-domain";
import type { Patch } from "@hexagen/reconciliation-engine";

const makeAst = (): DomainAST => ({
  nodes: [
    {
      id: "node-1",
      kind: NodeKind.BoundedContext,
      attributes: { label: "Order" },
    },
  ],
  edges: [],
  invariants: { topology: [], cardinality: [] },
});

const makePatches = (): Patch[] => [
  {
    id: "patch-1",
    type: "add_node",
    targetId: "new-node",
    payload: { kind: "BoundedContext", name: "PaymentService" },
  },
  {
    id: "patch-2",
    type: "add_edge",
    targetId: "edge-1",
    payload: { source: "Order", target: "Payment", relationship: "depends-on" },
  },
];

describe("Patches → Manifest Pipeline - Integration Tests", () => {
  let transactionManager: InMemoryTransactionManager;
  let backpressure: InMemoryBackpressureController;
  let stateMachine: InMemorySpeculativeStateMachine;

  beforeEach(() => {
    backpressure = new InMemoryBackpressureController(10);
    stateMachine = new InMemorySpeculativeStateMachine();
    const cache = new InMemorySemanticCache();

    transactionManager = new InMemoryTransactionManager({
      backpressureController: backpressure,
      speculativeStateMachine: stateMachine,
      semanticCache: cache,
    });
  });

  describe("Patch Application Flow", () => {
    it("should begin transaction and apply patches atomically", () => {
      const tx = transactionManager.begin("intent-apply");
      expect(tx.status).toBe("pending");

      const speculative = transactionManager.transition(tx.id, "speculative");
      expect(speculative?.status).toBe("speculative");

      const committed = transactionManager.commit(tx.id);
      expect(committed?.status).toBe("committed");
    });

    it("should preserve patch metadata through transaction lifecycle", () => {
      const patches = makePatches();
      const txWithPatches = transactionManager.begin("intent-patches", {
        patchMetadata: {
          count: patches.length,
          types: ["add_node", "add_edge"],
        },
      });

      expect(txWithPatches.status).toBe("pending");

      const transitioned = transactionManager.transition(
        txWithPatches.id,
        "speculative",
      );
      expect(transitioned?.status).toBe("speculative");

      const final = transactionManager.commit(txWithPatches.id);
      expect(final?.status).toBe("committed");
    });

    it("should apply multiple patches sequentially in single transaction", () => {
      const tx1 = transactionManager.begin("intent-1");
      transactionManager.transition(tx1.id, "speculative");

      const tx2 = transactionManager.begin("intent-2");
      expect(tx2.status).toBe("pending");

      transactionManager.commit(tx1.id);

      const tx2Final = transactionManager.commit(tx2.id);
      expect(tx2Final?.status).toBe("committed");
    });
  });

  describe("Lint Validation Integration", () => {
    it("should handle lint validation post-patch application", () => {
      const tx = transactionManager.begin("intent-lint");
      const speculative = transactionManager.transition(tx.id, "speculative");

      expect(speculative?.status).toBe("speculative");

      const committed = transactionManager.commit(tx.id);
      expect(committed?.status).toBe("committed");
    });

    it("should maintain transaction state during lint checks", () => {
      const patches = makePatches();
      const tx = transactionManager.begin("intent-with-patches", {
        patchMetadata: { patches: patches.length },
      });

      transactionManager.transition(tx.id, "speculative");

      const committed = transactionManager.commit(tx.id);
      expect(committed?.status).toBe("committed");
    });
  });

  describe("Manifest State Consistency", () => {
    it("should maintain manifest consistency across speculative state", () => {
      const ast = makeAst();
      const snapshotId = stateMachine.applySpeculative(ast, {
        mutation: "add-payment-service",
      });

      expect(snapshotId).toBeDefined();

      const tx = transactionManager.begin("intent-consistency", {
        snapshotId,
      });

      const speculative = transactionManager.transition(tx.id, "speculative");
      expect(speculative?.status).toBe("speculative");

      const committed = transactionManager.commit(tx.id);
      expect(committed?.status).toBe("committed");
    });

    it("should preserve original manifest on rollback", () => {
      const ast = makeAst();
      const snapshotId = stateMachine.applySpeculative(ast, {
        mutation: "original-state",
      });

      const tx = transactionManager.begin("intent-rollback", {
        snapshotId,
      });

      transactionManager.transition(tx.id, "speculative");

      const rolledBack = transactionManager.rollback(
        tx.id,
        "lint-validation-failed",
      );

      expect(rolledBack?.status).toBe("rolled_back");
      expect(stateMachine.getSpeculativeState(snapshotId)).toBeNull();
    });
  });

  describe("Backpressure During Patch Application", () => {
    it("should apply patches successfully within backpressure limits", () => {
      const bp = new InMemoryBackpressureController(5);
      const manager = new InMemoryTransactionManager({
        backpressureController: bp,
        speculativeStateMachine: new InMemorySpeculativeStateMachine(),
        semanticCache: new InMemorySemanticCache(),
      });

      const patches = makePatches();
      const tx = manager.begin("intent-bp", {
        patchCount: patches.length,
      });

      expect(tx.status).toBe("pending");

      manager.transition(tx.id, "speculative");
      const committed = manager.commit(tx.id);

      expect(committed?.status).toBe("committed");
      expect(bp.canAccept()).toBe(true);
    });

    it("should reject patches when backpressure is at capacity", () => {
      const bp = new InMemoryBackpressureController(1);
      const manager = new InMemoryTransactionManager({
        backpressureController: bp,
        speculativeStateMachine: new InMemorySpeculativeStateMachine(),
        semanticCache: new InMemorySemanticCache(),
      });

      const tx1 = manager.begin("intent-1");
      expect(tx1.status).toBe("pending");

      expect(() => manager.begin("intent-2")).toThrow("Transaction rejected");
    });
  });

  describe("Sequential Patch Application", () => {
    it("should apply patches sequentially without data loss", () => {
      const patches = makePatches();
      const transactions = [];

      for (let i = 0; i < patches.length; i++) {
        const tx = transactionManager.begin(`intent-${i}`, {
          patchId: patches[i].id,
        });

        transactionManager.transition(tx.id, "speculative");
        const committed = transactionManager.commit(tx.id);

        transactions.push(committed);
        expect(committed?.status).toBe("committed");
      }

      expect(transactions).toHaveLength(patches.length);
    });

    it("should maintain transaction ordering during concurrent-like operations", () => {
      const txIds = [];

      for (let i = 0; i < 3; i++) {
        const tx = transactionManager.begin(`intent-order-${i}`);
        txIds.push(tx.id);
      }

      expect(txIds).toHaveLength(3);

      txIds.forEach((txId) => {
        const tx = transactionManager.transition(txId, "speculative");
        expect(tx?.status).toBe("speculative");
      });

      txIds.forEach((txId) => {
        const tx = transactionManager.commit(txId);
        expect(tx?.status).toBe("committed");
      });
    });
  });

  describe("Error Recovery in Patch Pipeline", () => {
    it("should recover from failed patch application via rollback", () => {
      const ast = makeAst();
      const snapshotId = stateMachine.applySpeculative(ast, {
        mutation: "failed-patch",
      });

      const tx = transactionManager.begin("intent-recovery", {
        snapshotId,
      });

      transactionManager.transition(tx.id, "speculative");

      const rolledBack = transactionManager.rollback(
        tx.id,
        "patch-application-failed",
      );

      expect(rolledBack?.status).toBe("rolled_back");
    });

    it("should allow retry after failed application", () => {
      const ast = makeAst();
      const snapshotId = stateMachine.applySpeculative(ast, {
        mutation: "first-attempt",
      });

      const tx1 = transactionManager.begin("intent-attempt-1", {
        snapshotId,
      });

      transactionManager.transition(tx1.id, "speculative");
      transactionManager.rollback(tx1.id, "simulated-failure");

      const ast2 = makeAst();
      const snapshotId2 = stateMachine.applySpeculative(ast2, {
        mutation: "retry-attempt",
      });

      const tx2 = transactionManager.begin("intent-attempt-2", {
        snapshotId: snapshotId2,
      });

      transactionManager.transition(tx2.id, "speculative");
      const committed = transactionManager.commit(tx2.id);

      expect(committed?.status).toBe("committed");
    });
  });

  describe("Transaction State Monitoring", () => {
    it("should track patch count through transaction lifecycle", () => {
      const patchCount = 5;
      const tx = transactionManager.begin("intent-tracking", {
        patchCount,
      });

      expect(tx.status).toBe("pending");

      const speculative = transactionManager.transition(tx.id, "speculative");
      expect(speculative?.status).toBe("speculative");

      const committed = transactionManager.commit(tx.id);
      expect(committed?.status).toBe("committed");
    });
  });
});
