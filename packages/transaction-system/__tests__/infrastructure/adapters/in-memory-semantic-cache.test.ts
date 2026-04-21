import { InMemorySemanticCache } from "../../../src/infrastructure/adapters/in-memory-semantic-cache.adapter.js";
import type { DomainAST } from "@hexagen/core-domain";

import { NodeKind } from "@hexagen/core-domain";

const makeAst = (): DomainAST => ({
  nodes: [
    { id: "node-1", kind: NodeKind.Aggregate, attributes: { label: "Order" } },
  ],
  edges: [],
  invariants: { topology: [], cardinality: [] },
});

describe("InMemorySemanticCache", () => {
  let cache: InMemorySemanticCache;

  beforeEach(() => {
    cache = new InMemorySemanticCache();
  });

  describe("set() and get()", () => {
    it("should store and retrieve a value", () => {
      const ast = makeAst();
      cache.set("key-1", ast);

      const result = cache.get("key-1");

      expect(result).toEqual(ast);
    });

    it("should return null for non-existent key", () => {
      const result = cache.get("non-existent");

      expect(result).toBeNull();
    });

    it("should overwrite an existing value", () => {
      const ast1 = makeAst();
      const ast2: DomainAST = {
        nodes: [
          {
            id: "node-2",
            kind: NodeKind.Entity,
            attributes: { label: "Customer" },
          },
        ],
        edges: [],
        invariants: { topology: [], cardinality: [] },
      };
      cache.set("key-1", ast1);
      cache.set("key-1", ast2);

      const result = cache.get("key-1");

      expect(result!.nodes[0].id).toBe("node-2");
    });
  });

  describe("has()", () => {
    it("should return true for existing key", () => {
      cache.set("key-1", makeAst());

      expect(cache.has("key-1")).toBe(true);
    });

    it("should return false for non-existent key", () => {
      expect(cache.has("non-existent")).toBe(false);
    });
  });

  describe("delete()", () => {
    it("should remove a key from the cache", () => {
      cache.set("key-1", makeAst());
      cache.delete("key-1");

      expect(cache.get("key-1")).toBeNull();
    });

    it("should return true when deleting an existing key", () => {
      cache.set("key-1", makeAst());

      expect(cache.delete("key-1")).toBe(true);
    });

    it("should return false when deleting a non-existent key", () => {
      expect(cache.delete("non-existent")).toBe(false);
    });
  });

  describe("clear()", () => {
    it("should remove all entries and reset stats", () => {
      cache.set("key-1", makeAst());
      cache.set("key-2", makeAst());
      cache.get("key-1");

      cache.clear();

      const stats = cache.stats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe("stats()", () => {
    it("should track hits and misses", () => {
      cache.set("key-1", makeAst());
      cache.get("key-1");
      cache.get("non-existent");

      const stats = cache.stats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });

    it("should track multiple hits", () => {
      cache.set("key-1", makeAst());
      cache.get("key-1");
      cache.get("key-1");
      cache.get("key-1");

      const stats = cache.stats();

      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(0);
    });

    it("should count misses for non-existent keys", () => {
      cache.get("non-existent-1");
      cache.get("non-existent-2");

      const stats = cache.stats();

      expect(stats.misses).toBe(2);
      expect(stats.hits).toBe(0);
    });
  });

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      cache.set("key-1", makeAst(), 1);

      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(cache.get("key-1")).toBeNull();
      expect(cache.has("key-1")).toBe(false);
    });

    it("should not expire entries before TTL", () => {
      cache.set("key-1", makeAst(), 60000);

      const result = cache.get("key-1");

      expect(result).toBeDefined();
      expect(result!.nodes[0].id).toBe("node-1");
    });
  });
});
