import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { InMemoryTransactionManager } from "../../src/infrastructure/adapters/in-memory-transaction-manager.adapter.js";
import { InMemoryBackpressureController } from "../../src/infrastructure/adapters/in-memory-backpressure-controller.adapter.js";
import { InMemorySpeculativeStateMachine } from "../../src/infrastructure/adapters/in-memory-speculative-state-machine.adapter.js";
import { InMemorySemanticCache } from "../../src/infrastructure/adapters/in-memory-semantic-cache.adapter.js";
import { NodeKind } from "@hexagen/core-domain";
import type { DomainAST } from "@hexagen/core-domain";

const makeAst = (): DomainAST => ({
  nodes: [
    { id: "node-1", kind: NodeKind.Aggregate, attributes: { label: "Order" } },
  ],
  edges: [],
  invariants: { topology: [], cardinality: [] },
});

describe("transaction flow with simulated backpressure", () => {
  describe("full happy path", () => {
    it("begins pending, transitions to speculative, commits, and releases backpressure", () => {
      const backpressure = new InMemoryBackpressureController(10);
      const stateMachine = new InMemorySpeculativeStateMachine();
      const cache = new InMemorySemanticCache();

      const manager = new InMemoryTransactionManager({
        backpressureController: backpressure,
        speculativeStateMachine: stateMachine,
        semanticCache: cache,
      });

      const tx = manager.begin("intent-1");
      assert.strictEqual(tx.status, "pending");

      const speculative = manager.transition(tx.id, "speculative");
      assert.strictEqual(speculative?.status, "speculative");

      const committed = manager.commit(tx.id);
      assert.strictEqual(committed?.status, "committed");
      assert.strictEqual(backpressure.canAccept(), true);
    });
  });

  describe("rollback path", () => {
    it("begins, transitions to speculative, rolls back, and releases backpressure", () => {
      const backpressure = new InMemoryBackpressureController(10);
      const stateMachine = new InMemorySpeculativeStateMachine();
      const cache = new InMemorySemanticCache();

      const manager = new InMemoryTransactionManager({
        backpressureController: backpressure,
        speculativeStateMachine: stateMachine,
        semanticCache: cache,
      });

      const tx = manager.begin("intent-rollback");
      assert.strictEqual(tx.status, "pending");

      const speculative = manager.transition(tx.id, "speculative");
      assert.strictEqual(speculative?.status, "speculative");

      const rolledBack = manager.rollback(
        tx.id,
        "intentional rollback for test",
      );
      assert.strictEqual(rolledBack?.status, "rolled_back");
      assert.strictEqual(backpressure.canAccept(), true);
    });
  });

  describe("backpressure rejection", () => {
    it("rejects transactions at capacity and allows them after completion", () => {
      const backpressure = new InMemoryBackpressureController(1);
      const stateMachine = new InMemorySpeculativeStateMachine();
      const cache = new InMemorySemanticCache();

      const manager = new InMemoryTransactionManager({
        backpressureController: backpressure,
        speculativeStateMachine: stateMachine,
        semanticCache: cache,
      });

      const tx1 = manager.begin("intent-bp-1");
      assert.strictEqual(tx1.status, "pending");

      assert.throws(() => manager.begin("intent-bp-2"), /Transaction rejected/);

      manager.commit(tx1.id);

      const tx2 = manager.begin("intent-bp-2");
      assert.strictEqual(tx2.status, "pending");
    });
  });

  describe("speculative state machine integration", () => {
    it("commits and rolls back snapshots via the state machine", () => {
      const backpressure = new InMemoryBackpressureController(10);
      const stateMachine = new InMemorySpeculativeStateMachine();
      const cache = new InMemorySemanticCache();

      const manager = new InMemoryTransactionManager({
        backpressureController: backpressure,
        speculativeStateMachine: stateMachine,
        semanticCache: cache,
      });

      const ast = makeAst();
      const snapshotId = stateMachine.applySpeculative(ast, {
        mutation: "add-order",
      });
      const speculativeState = stateMachine.getSpeculativeState(snapshotId);
      assert.ok(speculativeState !== null);

      const tx = manager.begin("intent-spec-1", { snapshotId });
      assert.strictEqual(tx.status, "pending");

      manager.transition(tx.id, "speculative");

      const committed = manager.commit(tx.id);
      assert.strictEqual(committed?.status, "committed");
      assert.ok(stateMachine.getSpeculativeState(snapshotId) !== null);

      const ast2 = makeAst();
      const snapshotId2 = stateMachine.applySpeculative(ast2, {
        mutation: "add-invoice",
      });

      const tx2 = manager.begin("intent-spec-2", { snapshotId: snapshotId2 });
      manager.transition(tx2.id, "speculative");

      const rolledBack = manager.rollback(tx2.id, "invoice rejected");
      assert.strictEqual(rolledBack?.status, "rolled_back");
      assert.strictEqual(stateMachine.getSpeculativeState(snapshotId2), null);
    });
  });

  describe("semantic cache integration", () => {
    it("stores, retrieves, and respects TTL", async () => {
      const cache = new InMemorySemanticCache();

      cache.set("key-1", { result: "compiled-ast" }, 60000);
      const entry = cache.get("key-1");
      assert.ok(entry !== null);
      assert.deepStrictEqual(entry?.value, { result: "compiled-ast" });

      assert.strictEqual(cache.has("key-1"), true);

      cache.get("key-1");
      cache.get("key-missing");

      cache.set("key-ttl", "short-lived", 1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.strictEqual(cache.get("key-ttl"), null);
      assert.strictEqual(cache.has("key-ttl"), false);

      const stats = cache.stats();
      assert.strictEqual(stats.size, 1);
      assert.ok(stats.hits >= 2);
      assert.ok(stats.misses >= 2);
    });
  });
});
