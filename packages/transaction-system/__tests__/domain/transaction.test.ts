import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTransaction,
  transitionTransaction,
} from "../../src/domain/transaction.js";

describe("createTransaction", () => {
  it("should create a transaction with pending status", () => {
    const tx = createTransaction("intent-1");

    assert.strictEqual(tx.intentId, "intent-1");
    assert.strictEqual(tx.status, "pending");
    assert.match(tx.id, /^txn-/);
    assert.ok(tx.createdAt !== undefined);
    assert.ok(tx.updatedAt !== undefined);
    assert.deepStrictEqual(tx.metadata, {});
  });

  it("should create a transaction with custom metadata", () => {
    const metadata = { source: "editor", priority: "high" };
    const tx = createTransaction("intent-1", metadata);

    assert.deepStrictEqual(tx.metadata, metadata);
  });

  it("should generate unique IDs for each transaction", () => {
    const tx1 = createTransaction("intent-1");
    const tx2 = createTransaction("intent-2");

    assert.notStrictEqual(tx1.id, tx2.id);
  });

  it("should set createdAt and updatedAt to same timestamp", () => {
    const tx = createTransaction("intent-1");

    assert.strictEqual(tx.createdAt, tx.updatedAt);
  });
});

describe("transitionTransaction", () => {
  it("should transition to speculative status", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "speculative");

    assert.strictEqual(updated.status, "speculative");
    assert.strictEqual(updated.intentId, tx.intentId);
    assert.strictEqual(updated.id, tx.id);
  });

  it("should transition to committed status", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "committed");

    assert.strictEqual(updated.status, "committed");
  });

  it("should transition to rolled_back status", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "rolled_back");

    assert.strictEqual(updated.status, "rolled_back");
  });

  it("should transition to failed status", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "failed");

    assert.strictEqual(updated.status, "failed");
  });

  it("should update updatedAt timestamp on transition", () => {
    const tx = createTransaction("intent-1");
    const updated = transitionTransaction(tx, "speculative");

    assert.ok(updated.updatedAt >= tx.createdAt);
  });

  it("should preserve metadata through transitions", () => {
    const metadata = { source: "gesture" };
    const tx = createTransaction("intent-1", metadata);
    const updated = transitionTransaction(tx, "speculative");

    assert.deepStrictEqual(updated.metadata, metadata);
  });
});
