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
      expect(tx.status).toBe("pending");

      const speculative = manager.transition(tx.id, "speculative");
      expect(speculative?.status).toBe("speculative");

      const committed = manager.commit(tx.id);
      expect(committed?.status).toBe("committed");
      expect(backpressure.canAccept()).toBe(true);
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
      expect(tx.status).toBe("pending");

      const speculative = manager.transition(tx.id, "speculative");
      expect(speculative?.status).toBe("speculative");

      const rolledBack = manager.rollback(
        tx.id,
        "intentional rollback for test",
      );
      expect(rolledBack?.status).toBe("rolled_back");
      expect(backpressure.canAccept()).toBe(true);
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
      expect(tx1.status).toBe("pending");

      expect(() => manager.begin("intent-bp-2")).toThrow(
        "Transaction rejected",
      );

      manager.commit(tx1.id);

      const tx2 = manager.begin("intent-bp-2");
      expect(tx2.status).toBe("pending");
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
      expect(speculativeState).not.toBeNull();

      const tx = manager.begin("intent-spec-1", { snapshotId });
      expect(tx.status).toBe("pending");

      manager.transition(tx.id, "speculative");

      const committed = manager.commit(tx.id);
      expect(committed?.status).toBe("committed");
      expect(stateMachine.getSpeculativeState(snapshotId)).not.toBeNull();

      const ast2 = makeAst();
      const snapshotId2 = stateMachine.applySpeculative(ast2, {
        mutation: "add-invoice",
      });

      const tx2 = manager.begin("intent-spec-2", { snapshotId: snapshotId2 });
      manager.transition(tx2.id, "speculative");

      const rolledBack = manager.rollback(tx2.id, "invoice rejected");
      expect(rolledBack?.status).toBe("rolled_back");
      expect(stateMachine.getSpeculativeState(snapshotId2)).toBeNull();
    });
  });

  describe("semantic cache integration", () => {
    it("stores, retrieves, and respects TTL", async () => {
      const cache = new InMemorySemanticCache();

      cache.set("key-1", { result: "compiled-ast" }, 60000);
      const entry = cache.get("key-1");
      expect(entry).not.toBeNull();
      expect(entry?.value).toEqual({ result: "compiled-ast" });

      expect(cache.has("key-1")).toBe(true);

      cache.get("key-1");
      cache.get("key-missing");

      cache.set("key-ttl", "short-lived", 1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(cache.get("key-ttl")).toBeNull();
      expect(cache.has("key-ttl")).toBe(false);

      const stats = cache.stats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBeGreaterThanOrEqual(2);
      expect(stats.misses).toBeGreaterThanOrEqual(2);
    });
  });
});
