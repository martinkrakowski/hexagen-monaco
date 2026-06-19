import assert from "node:assert/strict";
import { describe, it, beforeEach, vi } from "vitest";
import { InMemoryTransactionManager } from "../../../src/infrastructure/adapters/in-memory-transaction-manager.adapter.js";
import { InMemoryBackpressureController } from "../../../src/infrastructure/adapters/in-memory-backpressure-controller.adapter.js";
import { InMemorySpeculativeStateMachine } from "../../../src/infrastructure/adapters/in-memory-speculative-state-machine.adapter.js";

describe("InMemoryTransactionManager", () => {
  let manager: InMemoryTransactionManager;

  beforeEach(() => {
    manager = new InMemoryTransactionManager();
  });

  describe("begin()", () => {
    it("should create a transaction with pending status", () => {
      const tx = manager.begin("intent-1");

      assert.strictEqual(tx.intentId, "intent-1");
      assert.strictEqual(tx.status, "pending");
    });

    it("should create a transaction with custom metadata", () => {
      const metadata = { source: "gesture" };
      const tx = manager.begin("intent-1", metadata);

      assert.deepStrictEqual(tx.metadata, metadata);
    });

    it("should store the transaction for later retrieval", () => {
      const tx = manager.begin("intent-1");
      const retrieved = manager.get(tx.id);

      assert.deepStrictEqual(retrieved, tx);
    });

    it("should store REM when provided", () => {
      const rem = {
        rules: { rule1: "value" },
        constraints: { constraint1: "value" },
        appliedAt: "2024-01-01T00:00:00Z",
      };
      const tx = manager.begin("intent-1", {}, rem);

      assert.deepStrictEqual(tx.metadata.rem, rem);
    });

    it("should store lineage when provided", () => {
      const lineage = ["intent-0", "intent-1"];
      const tx = manager.begin("intent-2", {}, undefined, lineage);

      assert.deepStrictEqual(tx.metadata.lineage, lineage);
    });

    it("should store both REM and lineage together", () => {
      const rem = {
        rules: { rule1: "value" },
        constraints: { constraint1: "value" },
        appliedAt: "2024-01-01T00:00:00Z",
      };
      const lineage = ["intent-0"];
      const tx = manager.begin(
        "intent-1",
        { source: "api", rulesApplied: 1 },
        rem,
        lineage,
      );

      assert.strictEqual(tx.metadata.source, "api");
      assert.deepStrictEqual(tx.metadata.rem, rem);
      assert.deepStrictEqual(tx.metadata.lineage, lineage);
      assert.strictEqual(tx.metadata.rulesApplied, 1);
      assert.strictEqual(tx.metadata.conflicts, undefined);
    });

    it("should be backward compatible without REM or lineage", () => {
      const metadata = { custom: "data" };
      const tx = manager.begin("intent-1", metadata);

      assert.deepStrictEqual(tx.metadata, metadata);
      assert.strictEqual(tx.metadata.rem, undefined);
      assert.strictEqual(tx.metadata.lineage, undefined);
    });

    it("should warn when lineage references non-existent prior intent", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lineage = ["non-existent-intent"];
      manager.begin("intent-1", {}, undefined, lineage);

      assert.ok(
        consoleSpy.mock.calls.some(
          (call) =>
            typeof call[0] === "string" &&
            call[0].includes(
              "[Lineage] Prior intent non-existent-intent not found",
            ),
        ),
      );
      consoleSpy.mockRestore();
    });

    it("should validate lineage chain correctly", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const tx1 = manager.begin("intent-0");
      const tx2 = manager.begin("intent-1", {}, undefined, [tx1.intentId]);

      assert.strictEqual(consoleSpy.mock.calls.length, 0);
      assert.deepStrictEqual(tx2.metadata.lineage, [tx1.intentId]);
      consoleSpy.mockRestore();
    });
  });

  describe("get()", () => {
    it("should return null for non-existent transaction", () => {
      const result = manager.get("non-existent");

      assert.strictEqual(result, null);
    });

    it("should return the transaction by id", () => {
      const tx = manager.begin("intent-1");
      const retrieved = manager.get(tx.id);

      assert.deepStrictEqual(retrieved, tx);
    });
  });

  describe("transition()", () => {
    it("should transition a transaction to a new status", () => {
      const tx = manager.begin("intent-1");
      const updated = manager.transition(tx.id, "speculative");

      assert.strictEqual(updated!.status, "speculative");
      assert.strictEqual(updated!.id, tx.id);
    });

    it("should return null for non-existent transaction", () => {
      const result = manager.transition("non-existent", "speculative");

      assert.strictEqual(result, null);
    });

    it("should persist the transition", () => {
      const tx = manager.begin("intent-1");
      manager.transition(tx.id, "speculative");
      const retrieved = manager.get(tx.id);

      assert.strictEqual(retrieved!.status, "speculative");
    });
  });

  describe("commit()", () => {
    it("should transition to committed status", () => {
      const tx = manager.begin("intent-1");
      const committed = manager.commit(tx.id);

      assert.strictEqual(committed!.status, "committed");
    });

    it("should return null for non-existent transaction", () => {
      const result = manager.commit("non-existent");

      assert.strictEqual(result, null);
    });
  });

  describe("rollback()", () => {
    it("should transition to rolled_back status", () => {
      const tx = manager.begin("intent-1");
      const rolledBack = manager.rollback(tx.id);

      assert.strictEqual(rolledBack!.status, "rolled_back");
    });

    it("should return null for non-existent transaction", () => {
      const result = manager.rollback("non-existent");

      assert.strictEqual(result, null);
    });
  });

  describe("list()", () => {
    it("should return all transactions when no filter is given", () => {
      manager.begin("intent-1");
      manager.begin("intent-2");

      const all = manager.list();

      assert.strictEqual(all.length, 2);
    });

    it("should filter transactions by status", () => {
      const tx1 = manager.begin("intent-1");
      manager.begin("intent-2");
      manager.transition(tx1.id, "speculative");

      const speculative = manager.list("speculative");

      assert.strictEqual(speculative.length, 1);
      assert.strictEqual(speculative[0].status, "speculative");
    });

    it("should return empty array when no transactions match filter", () => {
      manager.begin("intent-1");

      const committed = manager.list("committed");

      assert.strictEqual(committed.length, 0);
    });
  });

  describe("with backpressure controller", () => {
    let backpressureController: InMemoryBackpressureController;

    beforeEach(() => {
      backpressureController = new InMemoryBackpressureController(2);
      manager = new InMemoryTransactionManager({ backpressureController });
    });

    it("should succeed begin() when under capacity", () => {
      const tx = manager.begin("intent-1");

      assert.strictEqual(tx.intentId, "intent-1");
      assert.strictEqual(tx.status, "pending");
    });

    it("should throw on begin() when at capacity", () => {
      manager.begin("intent-1");
      manager.begin("intent-2");

      assert.throws(
        () => manager.begin("intent-3"),
        /Transaction rejected: Intent queued due to backpressure/,
      );
    });

    it("should free capacity on commit() via backpressureController.complete()", () => {
      const tx1 = manager.begin("intent-1");
      manager.begin("intent-2");

      manager.commit(tx1.id);

      assert.doesNotThrow(() => manager.begin("intent-3"));
    });
  });

  describe("with speculative state machine", () => {
    let speculativeStateMachine: InMemorySpeculativeStateMachine;

    beforeEach(() => {
      speculativeStateMachine = new InMemorySpeculativeStateMachine();
      manager = new InMemoryTransactionManager({ speculativeStateMachine });
    });

    it("should call commitSpeculative on commit() when snapshotId is in metadata", () => {
      const snapshotId = speculativeStateMachine.applySpeculative(
        { type: "root" } as any,
        { op: "test" },
      );
      const tx = manager.begin("intent-1", { snapshotId });

      const committed = manager.commit(tx.id);

      assert.strictEqual(committed!.status, "committed");
      assert.ok(
        speculativeStateMachine.getSpeculativeState(snapshotId) !== null,
      );
    });

    it("should call rollbackSpeculative on rollback() when snapshotId is in metadata", () => {
      const snapshotId = speculativeStateMachine.applySpeculative(
        { type: "root" } as any,
        { op: "test" },
      );
      const tx = manager.begin("intent-1", { snapshotId });

      const rolledBack = manager.rollback(tx.id);

      assert.strictEqual(rolledBack!.status, "rolled_back");
      assert.strictEqual(
        speculativeStateMachine.getSpeculativeState(snapshotId),
        null,
      );
    });
  });
});
