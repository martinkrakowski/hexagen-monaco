import { InMemoryTransactionManager } from "../../../src/infrastructure/adapters/in-memory-transaction-manager.adapter.js";

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
});
