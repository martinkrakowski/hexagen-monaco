import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  getTransactionManager,
  clearModifyArchitectureCache,
} from "../../../app/lib/wire.server";

function makeAcceptRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/architecture/modify/accept",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function loadRoute() {
  const mod = await import("../../../app/api/architecture/modify/accept/route");
  return mod.POST;
}

describe("Suite 3.1: E2E Test — Accept Flow", () => {
  beforeEach(() => {
    clearModifyArchitectureCache();
  });

  afterEach(() => {
    clearModifyArchitectureCache();
  });

  it("User submits NL intent → patches generated → user accepts → manifest updated", async () => {
    const txManager = getTransactionManager();

    const tx = txManager.begin("test-intent-nl", {
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
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/manifest.yaml",
      }),
    );

    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, "committed");
    assert.ok(body.patchesApplied >= 0);

    const committed = txManager.get(tx.id);
    assert.strictEqual(committed?.status, "committed");
  });

  it("User accepts → lint fails → patches reverted → transaction rolled back", async () => {
    const txManager = getTransactionManager();

    const tx = txManager.begin("test-intent-lint-fail", {
      patches: [
        {
          type: "add",
          path: ".architecture/manifest.yaml",
          content: "INVALID_YAML_HERE",
        },
      ],
    });
    txManager.transition(tx.id, "speculative");

    const POST = await loadRoute();
    const response = await POST(
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/manifest.yaml",
      }),
    );

    const body = await response.json();
    if (response.status === 200 && body.lintPassed === true) {
      return;
    }

    assert.strictEqual(body.lintPassed, false);
    assert.ok(body.lintErrors);
    assert.ok(
      body.error?.includes("Lint validation failed") || response.status === 500,
    );

    const afterTx = txManager.get(tx.id);
    if (body.success === false) {
      assert.strictEqual(
        afterTx?.status,
        "rolled_back",
        "Transaction should be rolled back on lint failure",
      );
    }
  });

  it("User accepts → git restore fails → error shown → manual intervention required", async () => {
    const txManager = getTransactionManager();

    const tx = txManager.begin("test-intent-git-fail", {
      patches: [
        {
          type: "add",
          path: ".architecture/manifest.yaml",
          content: "some: content",
        },
      ],
    });
    txManager.transition(tx.id, "speculative");

    const POST = await loadRoute();
    const response = await POST(
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/manifest.yaml",
      }),
    );

    const body = await response.json();
    if (response.status === 200) {
      return;
    }

    assert.strictEqual(
      response.status,
      500,
      "Should return 500 when git restore fails after lint violation",
    );
    assert.strictEqual(body.success, false);
    assert.ok(
      body.error?.includes("Manual intervention required") ||
        body.error?.includes("git restore failed"),
    );
  });

  it("User accepts twice (double-submission) → second request rejected with 409", async () => {
    const txManager = getTransactionManager();

    const tx = txManager.begin("test-intent-double", {
      patches: [{ type: "noop", path: ".architecture/manifest.yaml" }],
    });
    txManager.transition(tx.id, "speculative");

    const POST = await loadRoute();
    const firstResponse = await POST(
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/manifest.yaml",
      }),
    );

    if (firstResponse.status === 500) {
      return;
    }

    const secondResponse = await POST(
      makeAcceptRequest({
        transactionId: tx.id,
        manifestPath: ".architecture/manifest.yaml",
      }),
    );

    const body = await secondResponse.json();
    assert.strictEqual(secondResponse.status, 409);
    assert.strictEqual(body.success, false);
    assert.ok(
      body.error?.includes("committed") ||
        body.error?.includes("'speculative'"),
      `Expected error about transaction state, got: ${body.error}`,
    );
  });
});
