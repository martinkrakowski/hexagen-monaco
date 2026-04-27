import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  getTransactionManager,
  clearModifyArchitectureCache,
} from "../../../../../app/lib/wire.server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/architecture/modify/reject",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/architecture/modify/reject", () => {
  it("should return 400 if transactionId is missing", async () => {
    const { POST } =
      await import("../../../../../app/api/architecture/modify/reject/route");
    const response = await POST(makeRequest({}));
    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, "transactionId is required");
  });

  it("should return 404 if transaction not found", async () => {
    clearModifyArchitectureCache();
    const { POST } =
      await import("../../../../../app/api/architecture/modify/reject/route");
    const response = await POST(
      makeRequest({ transactionId: "nonexistent-txn" }),
    );
    assert.strictEqual(response.status, 404);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error, "Transaction not found");
  });

  it("should return 409 if transaction is not in speculative state", async () => {
    clearModifyArchitectureCache();
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-intent", {});
    const { POST } =
      await import("../../../../../app/api/architecture/modify/reject/route");
    const response = await POST(makeRequest({ transactionId: tx.id }));
    assert.strictEqual(response.status, 409);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.error.includes("pending"));
    clearModifyArchitectureCache();
  });

  it("should reject path traversal in manifestPath", async () => {
    clearModifyArchitectureCache();
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-intent", {});
    txManager.transition(tx.id, "speculative");
    const { POST } =
      await import("../../../../../app/api/architecture/modify/reject/route");
    const response = await POST(
      makeRequest({
        transactionId: tx.id,
        manifestPath: "../../etc/passwd",
      }),
    );
    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.error.includes("traversal"));
    clearModifyArchitectureCache();
  });

  it("should roll back speculative transaction and return 200", async () => {
    clearModifyArchitectureCache();
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-intent", {});
    txManager.transition(tx.id, "speculative");
    const { POST } =
      await import("../../../../../app/api/architecture/modify/reject/route");
    const response = await POST(
      makeRequest({
        transactionId: tx.id,
        reason: "User rejected",
      }),
    );
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, "rolled_back");
    assert.strictEqual(body.reason, "User rejected");
    const updatedTx = txManager.get(tx.id);
    assert.strictEqual(updatedTx?.status, "rolled_back");
    clearModifyArchitectureCache();
  });
});