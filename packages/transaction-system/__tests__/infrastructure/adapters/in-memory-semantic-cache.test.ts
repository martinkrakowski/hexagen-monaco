import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { InMemorySemanticCache } from "../../../src/infrastructure/adapters/in-memory-semantic-cache.adapter.js";

describe("InMemorySemanticCache", () => {
  let cache: InMemorySemanticCache;

  beforeEach(() => {
    cache = new InMemorySemanticCache();
  });

  describe("set() and get()", () => {
    it("should store and retrieve a value", () => {
      const value = { nodes: [{ id: "node-1", kind: "aggregate" }] };
      cache.set("key-1", value);

      const result = cache.get("key-1");

      assert.ok(result !== null);
      assert.deepStrictEqual(result!.value, value);
      assert.strictEqual(result!.key, "key-1");
    });

    it("should return null for non-existent key", () => {
      const result = cache.get("non-existent");

      assert.strictEqual(result, null);
    });

    it("should overwrite an existing value", () => {
      const value1 = { nodes: [{ id: "node-1" }] };
      const value2 = { nodes: [{ id: "node-2" }] };
      cache.set("key-1", value1);
      cache.set("key-1", value2);

      const result = cache.get("key-1");

      assert.deepStrictEqual(result!.value, value2);
    });
  });

  describe("has()", () => {
    it("should return true for existing key", () => {
      cache.set("key-1", { data: "test" });

      assert.strictEqual(cache.has("key-1"), true);
    });

    it("should return false for non-existent key", () => {
      assert.strictEqual(cache.has("non-existent"), false);
    });
  });

  describe("delete()", () => {
    it("should remove a key from the cache", () => {
      cache.set("key-1", { data: "test" });
      cache.delete("key-1");

      assert.strictEqual(cache.get("key-1"), null);
    });

    it("should return true when deleting an existing key", () => {
      cache.set("key-1", { data: "test" });

      assert.strictEqual(cache.delete("key-1"), true);
    });

    it("should return false when deleting a non-existent key", () => {
      assert.strictEqual(cache.delete("non-existent"), false);
    });
  });

  describe("clear()", () => {
    it("should remove all entries and reset stats", () => {
      cache.set("key-1", { data: "test1" });
      cache.set("key-2", { data: "test2" });
      cache.get("key-1");

      cache.clear();

      const stats = cache.stats();
      assert.strictEqual(stats.size, 0);
      assert.strictEqual(stats.hits, 0);
      assert.strictEqual(stats.misses, 0);
    });
  });

  describe("stats()", () => {
    it("should track hits and misses", () => {
      cache.set("key-1", { data: "test" });
      cache.get("key-1");
      cache.get("non-existent");

      const stats = cache.stats();

      assert.strictEqual(stats.hits, 1);
      assert.strictEqual(stats.misses, 1);
      assert.strictEqual(stats.size, 1);
    });

    it("should track multiple hits", () => {
      cache.set("key-1", { data: "test" });
      cache.get("key-1");
      cache.get("key-1");
      cache.get("key-1");

      const stats = cache.stats();

      assert.strictEqual(stats.hits, 3);
      assert.strictEqual(stats.misses, 0);
    });

    it("should count misses for non-existent keys", () => {
      cache.get("non-existent-1");
      cache.get("non-existent-2");

      const stats = cache.stats();

      assert.strictEqual(stats.misses, 2);
      assert.strictEqual(stats.hits, 0);
    });
  });

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      cache.set("key-1", { data: "test" }, 1);

      await new Promise((resolve) => setTimeout(resolve, 5));

      assert.strictEqual(cache.get("key-1"), null);
      assert.strictEqual(cache.has("key-1"), false);
    });

    it("should not expire entries before TTL", () => {
      cache.set("key-1", { data: "test" }, 60000);

      const result = cache.get("key-1");

      assert.ok(result !== null);
      assert.deepStrictEqual(result!.value, { data: "test" });
    });
  });
});
