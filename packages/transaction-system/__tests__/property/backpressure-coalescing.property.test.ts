import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryBackpressureController } from "../../src/infrastructure/adapters/in-memory-backpressure-controller.adapter.js";

function randomString(length: number = 8): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateDistinctIds(count: number): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  while (ids.length < count) {
    const id = randomString(12);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

describe("Property: Intent coalescing does not drop semantically distinct intents", () => {
  const NUM_RUNS = 1000;

  it("every distinct intentId should return tag none from accept()", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const controller = new InMemoryBackpressureController(100);
      const count = 1 + Math.floor(Math.random() * 50);
      const ids = generateDistinctIds(count);

      for (const id of ids) {
        const signal = controller.accept(id);
        assert.strictEqual(signal.tag, "none");
      }
    }
  });

  it("duplicate intentIds should get coalesce signal on second call", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const controller = new InMemoryBackpressureController(100);
      const intentId = randomString(12);

      const first = controller.accept(intentId);
      assert.strictEqual(first.tag, "none");

      const second = controller.accept(intentId);
      assert.strictEqual(second.tag, "coalesce");
    }
  });

  it("no semantically distinct (different string) intent is ever coalesced", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const controller = new InMemoryBackpressureController(100);
      const count = 2 + Math.floor(Math.random() * 48);
      const ids = generateDistinctIds(count);
      const results: Map<string, string> = new Map();

      for (const id of ids) {
        const signal = controller.accept(id);
        results.set(id, signal.tag);
      }

      for (const [, tag] of results) {
        assert.notStrictEqual(tag, "coalesce");
      }
    }
  });

  it("distinct intents after completing a previous intent are not coalesced", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const controller = new InMemoryBackpressureController(1);
      const id1 = randomString(12);
      const id2 = randomString(12);
      if (id1 === id2) continue;

      const signal1 = controller.accept(id1);
      assert.strictEqual(signal1.tag, "none");

      controller.complete(id1);

      const signal2 = controller.accept(id2);
      assert.notStrictEqual(signal2.tag, "coalesce");
    }
  });
});
