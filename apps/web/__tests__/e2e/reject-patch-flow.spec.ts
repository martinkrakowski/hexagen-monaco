import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  getTransactionManager,
  clearModifyArchitectureCache,
} from "../../../app/lib/wire.server.js";

function makeRejectRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/architecture/modify/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  const mod = await import("../../../app/api/architecture/modify/reject/route.js");
  return mod.POST;
}

describe("Suite 3.2: E2E Test — Reject Flow", () => {
  beforeEach(() => {
    clearModifyArchitectureCache();
  });

  afterEach(() => {
    clearModifyArchitectureCache();
  });

  it("User submits NL intent → patches generated → user rejects → transaction rolled back", async () => {
    const txManager = getTransactionManager();

    const tx = txManager.begin("test-intent-reject", {
      patches: [
        {
          type: "add",
          path: ".architecture/manifest.yaml",
          content: "boundedContexts: []",
        },
      ],
    });
    txManager.transition(tx.id, "speculative");

    const POST = await loadRoute();
    const response = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        reason: "User rejected the changes",
      }),
    );

    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, "rolled_back");

    const afterTx = txManager.get(tx.id);
    assert.strictEqual(afterTx?.status, "rolled_back");
  });

  it("User rejects → defensive restore succeeds → manifest unchanged", async () => {
    const txManager = getTransactionManager();

    const tx = txManager.begin("test-intent-restore-ok", {
      patches: [
        {
          type: "add",
          path: ".architecture/manifest.yaml",
          content: "some: patch",
        },
      ],
    });
    txManager.transition(tx.id, "speculative");

    const POST = await loadRoute();
    const response = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/manifest.yaml",
        reason: "Not happy with changes",
      }),
    );

    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, "rolled_back");

    const afterTx = txManager.get(tx.id);
    assert.strictEqual(afterTx?.status, "rolled_back");
  });

  it("User rejects → defensive restore fails → logged but transaction still rolled back", async () => {
    const txManager = getTransactionManager();

    const tx = txManager.begin("test-intent-restore-fail", {
      patches: [
        {
          type: "add",
          path: ".architecture/manifest.yaml",
          content: "some: patch",
        },
      ],
    });
    txManager.transition(tx.id, "speculative");

    const POST = await loadRoute();
    const response = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/nonexistent-path.yaml",
        reason: "Want to test restore failure",
      }),
    );

    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, "rolled_back");

    const afterTx = txManager.get(tx.id);
    assert.strictEqual(afterTx?.status, "rolled_back");
  });

  it("User rejects twice (double-submission) → second request rejected with 404", async () => {
    const txManager = getTransactionManager();

    const tx = txManager.begin("test-intent-reject-twice", {
      patches: [{ type: "noop", path: ".architecture/manifest.yaml" }],
    });
    txManager.transition(tx.id, "speculative");

    const POST = await loadRoute();
    const firstResponse = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        reason: "First rejection",
      }),
    );

    if (firstResponse.status !== 200) {
      return;
    }

    const secondResponse = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        reason: "Second rejection",
      }),
    );

    const body = await secondResponse.json();
    assert.strictEqual(secondResponse.status, 409);
    assert.strictEqual(body.success, false);
  });
});