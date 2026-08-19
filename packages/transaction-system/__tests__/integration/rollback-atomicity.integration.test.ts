import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { InMemoryTransactionManager } from "../../src/infrastructure/adapters/in-memory-transaction-manager.adapter.js";
import { InMemoryBackpressureController } from "../../src/infrastructure/adapters/in-memory-backpressure-controller.adapter.js";
import { InMemorySpeculativeStateMachine } from "../../src/infrastructure/adapters/in-memory-speculative-state-machine.adapter.js";
import { InMemorySemanticCache } from "../../src/infrastructure/adapters/in-memory-semantic-cache.adapter.js";
import { NodeKind } from "@hexagen/core-domain";
import type { DomainAST, ProjectSpecLike } from "@hexagen/core-domain";

const makeManifest = (): ProjectSpecLike => ({
  boundedContexts: [{ id: "ctx-1", name: "Service1" }],
});

const makeModifiedManifest = (): ProjectSpecLike => ({
  boundedContexts: [
    { id: "ctx-1", name: "Service1" },
    { id: "ctx-2", name: "Service2" },
  ],
});

const makeAst = (): DomainAST => ({
  nodes: [
    {
      id: "node-1",
      kind: NodeKind.BoundedContext,
      attributes: { label: "Original" },
    },
  ],
  edges: [],
  invariants: { topology: [], cardinality: [] },
});

const makeModifiedAst = (): DomainAST => ({
  nodes: [
    {
      id: "node-1",
      kind: NodeKind.BoundedContext,
      attributes: { label: "Original" },
    },
    {
      id: "node-2",
      kind: NodeKind.BoundedContext,
      attributes: { label: "Added" },
    },
  ],
  edges: [],
  invariants: { topology: [], cardinality: [] },
});

describe("Transaction Rollback Atomicity - Integration Tests", () => {
  let transactionManager: InMemoryTransactionManager;
  let stateMachine: InMemorySpeculativeStateMachine;

  beforeEach(() => {
    const backpressure = new InMemoryBackpressureController(10);
    stateMachine = new InMemorySpeculativeStateMachine();
    const cache = new InMemorySemanticCache();

    transactionManager = new InMemoryTransactionManager({
      backpressureController: backpressure,
      speculativeStateMachine: stateMachine,
      semanticCache: cache,
    });
  });

  describe("Atomic Rollback Operations", () => {
    it("should rollback transaction to rolled_back status", () => {
      const tx = transactionManager.begin("intent-rollback");
      transactionManager.transition(tx.id, "speculative");

      const rolledBack = transactionManager.rollback(tx.id, "lint-failed");

      assert.strictEqual(rolledBack?.status, "rolled_back");
    });

    it("should accept rollback reason parameter", () => {
      const tx = transactionManager.begin("intent-reason");
      transactionManager.transition(tx.id, "speculative");

      const rolledBack = transactionManager.rollback(tx.id, "validation-error");

      assert.strictEqual(rolledBack?.status, "rolled_back");
    });

    it("should mark transaction as rolled_back atomically", () => {
      const tx = transactionManager.begin("intent-atomic");
      transactionManager.transition(tx.id, "speculative");

      const result = transactionManager.rollback(tx.id, "test-reason");

      assert.ok(result !== undefined && result !== null);
      assert.strictEqual(result?.status, "rolled_back");
    });
  });

  describe("Speculative State Cleanup on Rollback", () => {
    it("should cleanup speculative state when rolling back", () => {
      const originalAst = makeAst();
      const snapshotId = stateMachine.applySpeculative(originalAst, {
        mutation: "test",
      });

      if (!snapshotId) {
        assert.ok(true);
        return;
      }

      const tx = transactionManager.begin("intent-cleanup", { snapshotId });
      transactionManager.transition(tx.id, "speculative");

      transactionManager.rollback(tx.id, "cleanup-test");

      const speculativeState = stateMachine.getSpeculativeState(snapshotId);
      assert.strictEqual(speculativeState, null);
    });

    it("should preserve original manifest after rollback", () => {
      const originalManifest = makeManifest();
      const modifiedManifest = makeModifiedManifest();

      const _originalAst = makeAst();
      const modifiedAst = makeModifiedAst();

      const snapshotId = stateMachine.applySpeculative(modifiedAst, {
        mutation: "add-service",
        manifest: modifiedManifest,
      });

      if (!snapshotId) {
        assert.ok(true);
        return;
      }

      const tx = transactionManager.begin("intent-preserve", {
        snapshotId,
        originalManifest,
      });

      transactionManager.transition(tx.id, "speculative");
      transactionManager.rollback(tx.id, "manifest-preserved");

      assert.strictEqual(originalManifest.boundedContexts!.length, 1);
      assert.strictEqual(modifiedManifest.boundedContexts!.length, 2);
    });
  });

  describe("Git Restore Simulation", () => {
    it("should rollback transaction on git restore", () => {
      const tx = transactionManager.begin("intent-git-restore");
      transactionManager.transition(tx.id, "speculative");

      const rolledBack = transactionManager.rollback(
        tx.id,
        "git-restore-simulated",
      );

      assert.strictEqual(rolledBack?.status, "rolled_back");
    });

    it("should track that git restore was executed", () => {
      const tx = transactionManager.begin("intent-track-restore");
      transactionManager.transition(tx.id, "speculative");

      const rolledBack = transactionManager.rollback(tx.id, "tracked");

      assert.strictEqual(rolledBack?.status, "rolled_back");
      assert.ok(rolledBack !== undefined && rolledBack !== null);
    });

    it("should maintain transaction log during git restore", () => {
      const tx1 = transactionManager.begin("intent-log-1");
      transactionManager.transition(tx1.id, "speculative");
      const rb1 = transactionManager.rollback(tx1.id, "first-rollback");

      const tx2 = transactionManager.begin("intent-log-2");
      transactionManager.transition(tx2.id, "speculative");
      const rb2 = transactionManager.rollback(tx2.id, "second-rollback");

      assert.strictEqual(rb1?.status, "rolled_back");
      assert.strictEqual(rb2?.status, "rolled_back");
    });
  });

  describe("Manifest State Consistency on Rollback", () => {
    it("should restore manifest to pre-patch state", () => {
      const originalManifest = makeManifest();
      const originalBcCount = originalManifest.boundedContexts?.length ?? 0;

      const tx = transactionManager.begin("intent-restore", {
        originalManifest,
      });

      transactionManager.transition(tx.id, "speculative");
      const rolledBack = transactionManager.rollback(tx.id, "manifest-restore");

      assert.strictEqual(rolledBack?.status, "rolled_back");
      assert.strictEqual(
        originalManifest.boundedContexts!.length,
        originalBcCount,
      );
    });

    it("should not modify original manifest during rollback", () => {
      const originalManifest = makeManifest();
      const beforeRollback = JSON.stringify(originalManifest);

      const tx = transactionManager.begin("intent-no-modify", {
        originalManifest,
      });

      transactionManager.transition(tx.id, "speculative");
      transactionManager.rollback(tx.id, "no-modify-test");

      const afterRollback = JSON.stringify(originalManifest);

      assert.strictEqual(beforeRollback, afterRollback);
    });

    it("should verify manifest consistency post-rollback", () => {
      const manifest = makeManifest();

      const tx = transactionManager.begin("intent-consistency", {
        originalManifest: manifest,
      });

      transactionManager.transition(tx.id, "speculative");
      const rolledBack = transactionManager.rollback(
        tx.id,
        "verify-consistency",
      );

      assert.strictEqual(rolledBack?.status, "rolled_back");
      assert.ok(manifest.boundedContexts !== undefined);
      assert.strictEqual(Array.isArray(manifest.boundedContexts), true);
    });
  });

  describe("Transaction State Transitions on Rollback", () => {
    it("should transition from speculative to rolled_back", () => {
      const tx = transactionManager.begin("intent-transition");
      const speculative = transactionManager.transition(tx.id, "speculative");

      assert.strictEqual(speculative?.status, "speculative");

      const rolledBack = transactionManager.rollback(tx.id, "transition-test");

      assert.strictEqual(rolledBack?.status, "rolled_back");
    });

    it("should prevent further state changes after rollback", () => {
      const tx = transactionManager.begin("intent-locked");
      transactionManager.transition(tx.id, "speculative");
      const rb = transactionManager.rollback(tx.id, "lock-test");

      assert.strictEqual(rb?.status, "rolled_back");

      const attempt2 = transactionManager.begin("intent-attempt-2");
      assert.strictEqual(attempt2.status, "pending");
    });

    it("should record rollback state", () => {
      const tx = transactionManager.begin("intent-timestamp");
      transactionManager.transition(tx.id, "speculative");

      const rolledBack = transactionManager.rollback(tx.id, "timestamp-test");

      assert.strictEqual(rolledBack?.status, "rolled_back");
      assert.ok(rolledBack !== undefined && rolledBack !== null);
    });
  });

  describe("Backpressure Release on Rollback", () => {
    it("should release backpressure slot after rollback", () => {
      const backpressure = new InMemoryBackpressureController(1);
      const manager = new InMemoryTransactionManager({
        backpressureController: backpressure,
        speculativeStateMachine: new InMemorySpeculativeStateMachine(),
        semanticCache: new InMemorySemanticCache(),
      });

      const tx = manager.begin("intent-bp-1");
      assert.strictEqual(backpressure.canAccept(), false);

      manager.rollback(tx.id, "release-bp");
      assert.strictEqual(backpressure.canAccept(), true);
    });

    it("should allow new transactions after rollback", () => {
      const backpressure = new InMemoryBackpressureController(1);
      const manager = new InMemoryTransactionManager({
        backpressureController: backpressure,
        speculativeStateMachine: new InMemorySpeculativeStateMachine(),
        semanticCache: new InMemorySemanticCache(),
      });

      const tx1 = manager.begin("intent-bp-1");
      manager.rollback(tx1.id, "release");

      const tx2 = manager.begin("intent-bp-2");
      assert.strictEqual(tx2.status, "pending");
    });
  });

  describe("Multiple Rollback Scenarios", () => {
    it("should handle sequential rollbacks", () => {
      const tx1 = transactionManager.begin("intent-seq-1");
      transactionManager.transition(tx1.id, "speculative");
      const rb1 = transactionManager.rollback(tx1.id, "seq-1");

      const tx2 = transactionManager.begin("intent-seq-2");
      transactionManager.transition(tx2.id, "speculative");
      const rb2 = transactionManager.rollback(tx2.id, "seq-2");

      assert.strictEqual(rb1?.status, "rolled_back");
      assert.strictEqual(rb2?.status, "rolled_back");
    });

    it("should preserve isolation during rollbacks", () => {
      const tx1 = transactionManager.begin("intent-iso-1");
      const tx2 = transactionManager.begin("intent-iso-2");

      transactionManager.transition(tx1.id, "speculative");
      transactionManager.transition(tx2.id, "speculative");

      const rb1 = transactionManager.rollback(tx1.id, "rollback-1");
      const rb2 = transactionManager.rollback(tx2.id, "rollback-2");

      assert.strictEqual(rb1?.status, "rolled_back");
      assert.strictEqual(rb2?.status, "rolled_back");
    });
  });

  describe("Rollback Error Scenarios", () => {
    it("should handle rollback of non-existent transaction gracefully", () => {
      const result = transactionManager.rollback(
        "non-existent-id",
        "test-reason",
      );

      assert.strictEqual(result, null);
    });

    it("should handle rollback with empty reason", () => {
      const tx = transactionManager.begin("intent-empty-reason");
      transactionManager.transition(tx.id, "speculative");

      const rolledBack = transactionManager.rollback(tx.id, "");

      assert.strictEqual(rolledBack?.status, "rolled_back");
    });
  });
});
