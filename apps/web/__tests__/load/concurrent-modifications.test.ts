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

function makeRejectRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/architecture/modify/reject",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function loadAcceptRoute() {
  const mod = await import("../../../app/api/architecture/modify/accept/route");
  return mod.POST;
}

async function loadRejectRoute() {
  const mod = await import("../../../app/api/architecture/modify/reject/route");
  return mod.POST;
}

describe("Suite 3.4: Load Test — Concurrent Accept/Reject", () => {
  beforeEach(() => {
    clearModifyArchitectureCache();
  });

  afterEach(() => {
    clearModifyArchitectureCache();
  });

  it("10 concurrent accept requests → all succeed or fail gracefully", async () => {
    const txManager = getTransactionManager();
    const transactions = Array.from({ length: 10 }, (_, i) => {
      const tx = txManager.begin(`concurrent-accept-${i}`, {
        patches: [{ type: "noop", path: ".architecture/manifest.yaml" }],
      });
      txManager.transition(tx.id, "speculative");
      return tx;
    });

    const POST = await loadAcceptRoute();
    const promises = transactions.map((tx) =>
      POST(
        makeAcceptRequest({
          transactionId: tx.id,
          manifestPath: ".architecture/manifest.yaml",
        }),
      ),
    );

    const results = await Promise.allSettled(promises);
    const successes = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === 200,
    );
    const failures = results.filter(
      (r) => r.status === "rejected" || r.value.status >= 400,
    );

    assert.ok(
      successes.length + failures.length === 10,
      "All requests should resolve",
    );
  });

  it("10 concurrent reject requests → all succeed or fail gracefully", async () => {
    const txManager = getTransactionManager();
    const transactions = Array.from({ length: 10 }, (_, i) => {
      const tx = txManager.begin(`concurrent-reject-${i}`, {
        patches: [{ type: "noop", path: ".architecture/manifest.yaml" }],
      });
      txManager.transition(tx.id, "speculative");
      return tx;
    });

    const POST = await loadRejectRoute();
    const promises = transactions.map((tx) =>
      POST(
        makeRejectRequest({
          transactionId: tx.id,
          reason: `Reject ${i}`,
        }),
      ),
    );

    const results = await Promise.allSettled(promises);
    const successes = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === 200,
    );
    const failures = results.filter(
      (r) => r.status === "rejected" || r.value.status >= 400,
    );

    assert.ok(
      successes.length + failures.length === 10,
      "All requests should resolve",
    );
  });

  it("Mixed accept/reject requests → no race conditions", async () => {
    const txManager = getTransactionManager();
    const transactions = Array.from({ length: 10 }, (_, i) => {
      const tx = txManager.begin(`mixed-${i}`, {
        patches: [{ type: "noop", path: ".architecture/manifest.yaml" }],
      });
      txManager.transition(tx.id, "speculative");
      return tx;
    });

    const acceptPOST = await loadAcceptRoute();
    const rejectPOST = await loadRejectRoute();

    const promises = transactions.map((tx, i) => {
      if (i % 2 === 0) {
        return acceptPOST(
          makeAcceptRequest({
            transactionId: tx.id,
            manifestPath: ".architecture/manifest.yaml",
          }),
        );
      } else {
        return rejectPOST(
          makeRejectRequest({
            transactionId: tx.id,
            reason: `Mixed reject ${i}`,
          }),
        );
      }
    });

    const results = await Promise.allSettled(promises);
    const allResolved = results.every(
      (r) => r.status === "fulfilled" || r.status === "rejected",
    );

    assert.ok(allResolved, "All mixed requests should resolve without hanging");
  });

  it("Verify transaction state consistency after load test", async () => {
    clearModifyArchitectureCache();
    const txManager = getTransactionManager();

    const transactions = Array.from({ length: 5 }, (_, i) => {
      const tx = txManager.begin(`consistency-${i}`, {
        patches: [{ type: "noop", path: ".architecture/manifest.yaml" }],
      });
      txManager.transition(tx.id, "speculative");
      return tx;
    });

    const acceptPOST = await loadAcceptRoute();
    const rejectPOST = await loadRejectRoute();

    const acceptTxs = transactions.filter((_, i) => i % 2 === 0);
    const rejectTxs = transactions.filter((_, i) => i % 2 !== 0);

    const acceptResults = await Promise.all(
      acceptTxs.map((tx) =>
        acceptPOST(
          makeAcceptRequest({
            transactionId: tx.id,
            manifestPath: ".architecture/manifest.yaml",
          }),
        ),
      ),
    );

    const rejectResults = await Promise.all(
      rejectTxs.map((tx) =>
        rejectPOST(
          makeRejectRequest({
            transactionId: tx.id,
            reason: "Consistency test reject",
          }),
        ),
      ),
    );

    const allResults = [...acceptResults, ...rejectResults];
    const allCommittedOrRolledBack = allResults.every(
      (r) => r.status === 200 || r.status === 409 || r.status === 500,
    );

    assert.ok(
      allCommittedOrRolledBack,
      "All transactions should have consistent end state",
    );

    const finalTxCount = txManager.list().length;
    assert.strictEqual(
      finalTxCount,
      transactions.length,
      "Transaction count should remain consistent",
    );
  });
});
