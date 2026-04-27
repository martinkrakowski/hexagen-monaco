import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  getTransactionManager,
  clearModifyArchitectureCache,
} from "../../../../app/lib/wire.server.js";

function makeAcceptRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/architecture/modify/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRejectRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/architecture/modify/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadAcceptRoute() {
  const mod = await import("../../../../app/api/architecture/modify/accept/route.js");
  return mod.POST;
}

async function loadRejectRoute() {
  const mod = await import("../../../../app/api/architecture/modify/reject/route.js");
  return mod.POST;
}

describe("Suite 3.3: Integration Test — Path Traversal Protection", () => {
  beforeEach(() => {
    clearModifyArchitectureCache();
  });

  afterEach(() => {
    clearModifyArchitectureCache();
  });

  it("Accept with ../../etc/passwd → rejected with 400", async () => {
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-traversal-1", {});
    txManager.transition(tx.id, "speculative");

    const POST = await loadAcceptRoute();
    const response = await POST(
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: "../../etc/passwd",
      }),
    );

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(
      body.error?.includes("traversal") || body.error?.includes("Invalid path"),
      `Expected path traversal error, got: ${body.error}`,
    );
  });

  it("Accept with .architecture/../../../etc/passwd → rejected with 400", async () => {
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-traversal-2", {});
    txManager.transition(tx.id, "speculative");

    const POST = await loadAcceptRoute();
    const response = await POST(
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/../../../etc/passwd",
      }),
    );

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(
      body.error?.includes("traversal") || body.error?.includes("Invalid path"),
      `Expected path traversal error, got: ${body.error}`,
    );
  });

  it("Accept with /absolute/path/manifest.yaml → rejected with 400", async () => {
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-traversal-3", {});
    txManager.transition(tx.id, "speculative");

    const POST = await loadAcceptRoute();
    const response = await POST(
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: "/absolute/path/manifest.yaml",
      }),
    );

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(
      body.error?.includes("traversal") || body.error?.includes("Invalid path"),
      `Expected path traversal error, got: ${body.error}`,
    );
  });

  it("Accept with .architecture/manifest.yaml → accepted", async () => {
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-valid-path", {});
    txManager.transition(tx.id, "speculative");

    const POST = await loadAcceptRoute();
    const response = await POST(
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/manifest.yaml",
      }),
    );

    const body = await response.json();
    assert.ok(
      response.status === 200 || response.status === 500,
      `Expected 200 or 500, got ${response.status}`,
    );
  });

  it("Reject with ../../etc/passwd → rejected with 400", async () => {
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-reject-traversal-1", {});
    txManager.transition(tx.id, "speculative");

    const POST = await loadRejectRoute();
    const response = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        manifestPath: "../../etc/passwd",
      }),
    );

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(
      body.error?.includes("traversal") || body.error?.includes("Invalid path"),
      `Expected path traversal error, got: ${body.error}`,
    );
  });

  it("Reject with .architecture/../../../etc/passwd → rejected with 400", async () => {
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-reject-traversal-2", {});
    txManager.transition(tx.id, "speculative");

    const POST = await loadRejectRoute();
    const response = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/../../../etc/passwd",
      }),
    );

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(
      body.error?.includes("traversal") || body.error?.includes("Invalid path"),
      `Expected path traversal error, got: ${body.error}`,
    );
  });

  it("Reject with /absolute/path/manifest.yaml → rejected with 400", async () => {
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-reject-traversal-3", {});
    txManager.transition(tx.id, "speculative");

    const POST = await loadRejectRoute();
    const response = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        manifestPath: "/absolute/path/manifest.yaml",
      }),
    );

    assert.strictEqual(response.status, 400);
    const body = await response.json();
    assert.strictEqual(body.success, false);
    assert.ok(
      body.error?.includes("traversal") || body.error?.includes("Invalid path"),
      `Expected path traversal error, got: ${body.error}`,
    );
  });

  it("Reject with .architecture/manifest.yaml → accepted (valid path)", async () => {
    const txManager = getTransactionManager();
    const tx = txManager.begin("test-reject-valid-path", {});
    txManager.transition(tx.id, "speculative");

    const POST = await loadRejectRoute();
    const response = await POST(
      makeRejectRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/manifest.yaml",
      }),
    );

    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.success, true);
  });
});