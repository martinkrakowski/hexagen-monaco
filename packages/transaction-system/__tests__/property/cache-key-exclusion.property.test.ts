import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CacheEntry } from "../../src/domain/value-objects/cache-entry.js";
import { InMemorySemanticCache } from "../../src/infrastructure/adapters/in-memory-semantic-cache.adapter.js";
import { InMemoryBackpressureController } from "../../src/infrastructure/adapters/in-memory-backpressure-controller.adapter.js";

function randomString(length: number = 8): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function randomValue(): unknown {
  const roll = Math.random();
  if (roll < 0.25) return randomString(12);
  if (roll < 0.5) return Math.floor(Math.random() * 10000);
  if (roll < 0.75)
    return {
      payload: randomString(6),
      version: Math.floor(Math.random() * 100),
    };
  return [randomString(4), randomString(4)];
}

describe("Property: Cache key excludes transient/spatial data", () => {
  const NUM_RUNS = 1000;

  it("for any two entries with the same key, get(key) returns the most recently set entry", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const cache = new InMemorySemanticCache();
      const key = randomString(10);
      const value1 = randomValue();
      const value2 = randomValue();

      cache.set(key, value1);
      cache.set(key, value2);

      const entry: CacheEntry | null = cache.get(key);
      assert.ok(entry !== null);
      assert.strictEqual((entry as CacheEntry).value, value2);
    }
  });

  it("for any expired entry (ttl=1), get() returns null after 5ms", async () => {
    let checked = 0;
    for (let run = 0; run < Math.min(NUM_RUNS, 200); run++) {
      const cache = new InMemorySemanticCache();
      const key = randomString(10);
      const value = randomValue();

      cache.set(key, value, 1);

      await new Promise((r) => setTimeout(r, 5));

      assert.strictEqual(cache.get(key), null);
      assert.strictEqual(cache.has(key), false);
      checked++;
    }
    assert.ok(checked > 0);
  });

  it("non-expired entries remain accessible", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const cache = new InMemorySemanticCache();
      const key = randomString(10);
      const value = randomValue();

      cache.set(key, value, 60000);

      assert.strictEqual(cache.has(key), true);
      const entry = cache.get(key);
      assert.ok(entry !== null);
      assert.strictEqual((entry as CacheEntry).value, value);
    }
  });
});

describe("Property: Intent coalescing does not drop semantically distinct intents", () => {
  const NUM_RUNS = 1000;

  it("for any two distinct intentIds, both should be accepted (tag !== coalesce)", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const controller = new InMemoryBackpressureController(10, 5000);
      const id1 = randomString(12);
      const id2 = randomString(12);
      if (id1 === id2) continue;

      const signal1 = controller.accept(id1);
      const signal2 = controller.accept(id2);

      assert.notStrictEqual(signal1.tag, "coalesce");
      assert.notStrictEqual(signal2.tag, "coalesce");
    }
  });

  it("for the same intentId called twice, the second should get coalesce signal", () => {
    for (let run = 0; run < NUM_RUNS; run++) {
      const controller = new InMemoryBackpressureController(10, 5000);
      const intentId = randomString(12);

      controller.accept(intentId);
      const signal = controller.accept(intentId);

      assert.strictEqual(signal.tag, "coalesce");
    }
  });
});
