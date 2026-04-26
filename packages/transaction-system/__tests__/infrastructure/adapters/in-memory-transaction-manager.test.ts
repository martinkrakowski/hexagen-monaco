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

      expect(tx.intentId).toBe("intent-1");
      expect(tx.status).toBe("pending");
    });

    it("should create a transaction with custom metadata", () => {
      const metadata = { source: "gesture" };
      const tx = manager.begin("intent-1", metadata);

      expect(tx.metadata).toEqual(metadata);
    });

    it("should store the transaction for later retrieval", () => {
      const tx = manager.begin("intent-1");
      const retrieved = manager.get(tx.id);

      expect(retrieved).toEqual(tx);
    });

    it("should store REM when provided", () => {
      const rem = {
        rules: { rule1: "value" },
        constraints: { constraint1: "value" },
        appliedAt: "2024-01-01T00:00:00Z",
      };
      const tx = manager.begin("intent-1", {}, rem);

      expect(tx.metadata.rem).toEqual(rem);
    });

    it("should store lineage when provided", () => {
      const lineage = ["intent-0", "intent-1"];
      const tx = manager.begin("intent-2", {}, undefined, lineage);

      expect(tx.metadata.lineage).toEqual(lineage);
    });

    it("should store both REM and lineage together", () => {
      const rem = {
        rules: { rule1: "value" },
        constraints: { constraint1: "value" },
        appliedAt: "2024-01-01T00:00:00Z",
      };
      const lineage = ["intent-0"];
      const tx = manager.begin("intent-1", { source: "api", rulesApplied: 1 }, rem, lineage);

      expect(tx.metadata.source).toBe("api");
      expect(tx.metadata.rem).toEqual(rem);
      expect(tx.metadata.lineage).toEqual(lineage);
      expect(tx.metadata.rulesApplied).toBe(1);
      // No conflicts since rulesApplied (1) matches REM rules count (1)
      expect(tx.metadata.conflicts).toBeUndefined();
    });

    it("should be backward compatible without REM or lineage", () => {
      const metadata = { custom: "data" };
      const tx = manager.begin("intent-1", metadata);

      expect(tx.metadata).toEqual(metadata);
      expect(tx.metadata.rem).toBeUndefined();
      expect(tx.metadata.lineage).toBeUndefined();
    });

    it("should warn when lineage references non-existent prior intent", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      const lineage = ["non-existent-intent"];
      manager.begin("intent-1", {}, undefined, lineage);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Lineage] Prior intent non-existent-intent not found"),
      );
      consoleSpy.mockRestore();
    });

    it("should validate lineage chain correctly", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      const tx1 = manager.begin("intent-0");
      const tx2 = manager.begin("intent-1", {}, undefined, [tx1.intentId]);

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(tx2.metadata.lineage).toEqual([tx1.intentId]);
      consoleSpy.mockRestore();
    });
  });

  describe("get()", () => {
    it("should return null for non-existent transaction", () => {
      const result = manager.get("non-existent");

      expect(result).toBeNull();
    });

    it("should return the transaction by id", () => {
      const tx = manager.begin("intent-1");
      const retrieved = manager.get(tx.id);

      expect(retrieved).toEqual(tx);
    });
  });

  describe("transition()", () => {
    it("should transition a transaction to a new status", () => {
      const tx = manager.begin("intent-1");
      const updated = manager.transition(tx.id, "speculative");

      expect(updated!.status).toBe("speculative");
      expect(updated!.id).toBe(tx.id);
    });

    it("should return null for non-existent transaction", () => {
      const result = manager.transition("non-existent", "speculative");

      expect(result).toBeNull();
    });

    it("should persist the transition", () => {
      const tx = manager.begin("intent-1");
      manager.transition(tx.id, "speculative");
      const retrieved = manager.get(tx.id);

      expect(retrieved!.status).toBe("speculative");
    });
  });

  describe("commit()", () => {
    it("should transition to committed status", () => {
      const tx = manager.begin("intent-1");
      const committed = manager.commit(tx.id);

      expect(committed!.status).toBe("committed");
    });

    it("should return null for non-existent transaction", () => {
      const result = manager.commit("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("rollback()", () => {
    it("should transition to rolled_back status", () => {
      const tx = manager.begin("intent-1");
      const rolledBack = manager.rollback(tx.id);

      expect(rolledBack!.status).toBe("rolled_back");
    });

    it("should return null for non-existent transaction", () => {
      const result = manager.rollback("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("list()", () => {
    it("should return all transactions when no filter is given", () => {
      manager.begin("intent-1");
      manager.begin("intent-2");

      const all = manager.list();

      expect(all).toHaveLength(2);
    });

    it("should filter transactions by status", () => {
      const tx1 = manager.begin("intent-1");
      manager.begin("intent-2");
      manager.transition(tx1.id, "speculative");

      const speculative = manager.list("speculative");

      expect(speculative).toHaveLength(1);
      expect(speculative[0].status).toBe("speculative");
    });

    it("should return empty array when no transactions match filter", () => {
      manager.begin("intent-1");

      const committed = manager.list("committed");

      expect(committed).toHaveLength(0);
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

      expect(tx.intentId).toBe("intent-1");
      expect(tx.status).toBe("pending");
    });

    it("should throw on begin() when at capacity", () => {
      manager.begin("intent-1");
      manager.begin("intent-2");

      expect(() => manager.begin("intent-3")).toThrow(
        "Transaction rejected: Intent queued due to backpressure",
      );
    });

    it("should free capacity on commit() via backpressureController.complete()", () => {
      const tx1 = manager.begin("intent-1");
      manager.begin("intent-2");

      manager.commit(tx1.id);

      expect(() => manager.begin("intent-3")).not.toThrow();
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

      expect(committed!.status).toBe("committed");
      expect(
        speculativeStateMachine.getSpeculativeState(snapshotId),
      ).not.toBeNull();
    });

    it("should call rollbackSpeculative on rollback() when snapshotId is in metadata", () => {
      const snapshotId = speculativeStateMachine.applySpeculative(
        { type: "root" } as any,
        { op: "test" },
      );
      const tx = manager.begin("intent-1", { snapshotId });

      const rolledBack = manager.rollback(tx.id);

      expect(rolledBack!.status).toBe("rolled_back");
      expect(
        speculativeStateMachine.getSpeculativeState(snapshotId),
      ).toBeNull();
    });
  });
});
