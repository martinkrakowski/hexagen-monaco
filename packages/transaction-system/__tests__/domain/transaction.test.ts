import {
  createTransaction,
  transitionTransaction,
} from "../../src/domain/transaction.js";

describe("createTransaction", () => {
  it("should create a transaction with pending status", () => {
    const tx = createTransaction("intent-1");

    expect(tx.intentId).toBe("intent-1");
    expect(tx.status).toBe("pending");
    expect(tx.id).toMatch(/^txn-/);
    expect(tx.createdAt).toBeDefined();
    expect(tx.updatedAt).toBeDefined();
    expect(tx.metadata).toEqual({});
  });

  it("should create a transaction with custom metadata", () => {
    const metadata = { source: "editor", priority: "high" };
    const tx = createTransaction("intent-1", metadata);

    expect(tx.metadata).toEqual(metadata);
  });

  it("should generate unique IDs for each transaction", () => {
    const tx1 = createTransaction("intent-1");
    const tx2 = createTransaction("intent-2");

    expect(tx1.id).not.toBe(tx2.id);
  });

  it("should set createdAt and updatedAt to same timestamp", () => {
    const tx = createTransaction("intent-1");

    expect(tx.createdAt).toBe(tx.updatedAt);
  });
});

describe("transitionTransaction", () => {
  it("should transition to speculative status", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "speculative");

    expect(updated.status).toBe("speculative");
    expect(updated.intentId).toBe(tx.intentId);
    expect(updated.id).toBe(tx.id);
  });

  it("should transition to committed status", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "committed");

    expect(updated.status).toBe("committed");
  });

  it("should transition to rolled_back status", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "rolled_back");

    expect(updated.status).toBe("rolled_back");
  });

  it("should transition to failed status", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "failed");

    expect(updated.status).toBe("failed");
  });

  it("should update updatedAt timestamp on transition", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "speculative");

    expect(updated.updatedAt).toBeGreaterThanOrEqual(tx.createdAt);
  });

  it("should preserve metadata through transitions", () => {
    const metadata = { source: "gesture" };
    const tx = createTransaction("intent-1", metadata);
    const updated = transitionTransaction(tx, "speculative");

    expect(updated.metadata).toEqual(metadata);
  });
});
