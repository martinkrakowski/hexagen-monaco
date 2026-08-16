import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "vitest";
import type { BoundedContext, Manifest } from "@hexagen/sync";
import { PersistenceFake } from "./persistence-fake.js";

/**
 * Builds a fixture context whose ports live where the manifest schema actually
 * puts them — `layers.application.ports.{in,out}`. These fixtures used to hang
 * a `ports: [{ name, direction }]` array off the context root, a shape
 * `BoundedContext` has never had; it survived only because nothing type-checked
 * this file (AUD-020).
 */
function makeContext(
  name: string,
  ports: { in?: string[]; out?: string[] } = {},
): BoundedContext {
  return { name, layers: { application: { ports } } };
}

describe("PersistenceFake", () => {
  let fake: PersistenceFake;

  beforeEach(() => {
    fake = new PersistenceFake();
  });

  afterEach(() => {
    fake.clear();
  });

  describe("writeManifestSync - happy path", () => {
    it("should write manifest successfully and return success result", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [makeContext("test-context")],
      };

      const result = fake.writeManifestSync(
        "/fake/path/manifest.yaml",
        testManifest,
      );

      assert.strictEqual(result.success, true);
      assert.ok(!result.error);
    });

    it("should store manifest in memory for later retrieval", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [makeContext("test-context")],
      };

      fake.writeManifestSync("/fake/path/manifest.yaml", testManifest);

      assert.strictEqual(fake.hasManifest("/fake/path/manifest.yaml"), true);
    });

    it("should increment write counter on successful write", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      fake.writeManifestSync("/path/manifest.yaml", testManifest);

      assert.strictEqual(fake.getWriteCount(), 1);
    });

    it("should increment write counter on each subsequent write", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      fake.writeManifestSync("/path/manifest.yaml", testManifest);
      fake.writeManifestSync("/path/manifest.yaml", testManifest);

      assert.strictEqual(fake.getWriteCount(), 2);
    });
  });

  describe("readManifestSync - happy path", () => {
    it("should read manifest successfully and return data", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [makeContext("test-context")],
      };

      fake.writeManifestSync("/fake/path/manifest.yaml", testManifest);

      const result = fake.readManifestSync("/fake/path/manifest.yaml");

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.data, testManifest);
      }
    });

    it("should increment read counter on successful read", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      fake.writeManifestSync("/path/manifest.yaml", testManifest);
      fake.readManifestSync("/path/manifest.yaml");

      assert.strictEqual(fake.getReadCount(), 1);
    });
  });

  describe("read/write async variants", () => {
    it("should write and read successfully using async methods", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [makeContext("async-test-context")],
      };

      const writeResult = await fake.writeManifest(
        "/fake/path/manifest.yaml",
        testManifest,
      );

      assert.strictEqual(writeResult.success, true);

      const readResult = await fake.readManifest("/fake/path/manifest.yaml");

      if (readResult.success) {
        assert.deepStrictEqual(readResult.data, testManifest);
      } else {
        assert.fail("Expected success but got error");
      }
    });

    it("should increment counters on async operations", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      await fake.writeManifest("/path/manifest.yaml", testManifest);
      await fake.readManifest("/path/manifest.yaml");

      assert.strictEqual(fake.getWriteCount(), 1);
      assert.strictEqual(fake.getReadCount(), 1);
    });
  });

  describe("invalid input rejection", () => {
    it("should reject manifest missing bounded_contexts field", async () => {
      const invalidManifest: unknown = { version: "1.0.0" }; // Missing bounded_contexts

      const result = fake.writeManifestSync(
        "/fake/path/manifest.yaml",
        invalidManifest as Manifest,
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.message.includes("missing bounded_contexts"));
    });

    it("should reject manifest with non-array bounded_contexts", async () => {
      const invalidManifest: Partial<Manifest> = {
        version: "1.0.0",
        bounded_contexts:
          "not-an-array" as unknown as Manifest["bounded_contexts"],
      };

      const result = fake.writeManifestSync(
        "/fake/path/manifest.yaml",
        invalidManifest as Manifest,
      );

      assert.strictEqual(result.success, false);
    });

    it("should reject read of non-existent manifest", async () => {
      const result = fake.readManifestSync("/nonexistent/path/manifest.yaml");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(
          result.error?.message.includes("not found"),
          "Error should mention file not found",
        );
      }
    });

    it("should reject async read of non-existent manifest", async () => {
      const result = await fake.readManifest("/nonexistent/path/manifest.yaml");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(
          result.error?.message.includes("not found"),
          "Error should mention file not found",
        );
      }
    });
  });

  describe("error injection for testing", () => {
    it("should fail write when setFailWriteOnNext is called", async () => {
      fake.setFailWriteOnNext();

      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      const result = fake.writeManifestSync(
        "/path/manifest.yaml",
        testManifest,
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(
          result.error?.message.includes("Injected write failure"),
          "Error should be injected failure message",
        );
      }
    });

    it("should fail read when setFailReadOnNext is called", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      fake.writeManifestSync("/path/manifest.yaml", testManifest);
      fake.setFailReadOnNext();

      const result = fake.readManifestSync("/path/manifest.yaml");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(
          result.error?.message.includes("Injected read failure"),
          "Error should be injected failure message",
        );
      }
    });

    it("should only fail once then resume normal operation", async () => {
      fake.setFailWriteOnNext();

      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      // First write should fail
      let result = fake.writeManifestSync("/path/manifest.yaml", testManifest);
      assert.strictEqual(result.success, false);

      // Second write should succeed (failure flag cleared)
      result = fake.writeManifestSync("/path/manifest.yaml", testManifest);
      assert.strictEqual(result.success, true);
    });
  });

  describe("round-trip operations", () => {
    it("should preserve data through write then read cycle", async () => {
      const originalManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [
          makeContext("context-a", { in: ["port-1"] }),
          makeContext("context-b"),
        ],
      };

      fake.writeManifestSync("/path/manifest.yaml", originalManifest);
      const readResult = fake.readManifestSync("/path/manifest.yaml");

      if (readResult.success) {
        assert.deepStrictEqual(readResult.data, originalManifest);
      } else {
        assert.fail("Expected success but got error in round-trip test");
      }
    });

    it("should preserve data through async write-then-read cycle", async () => {
      const originalManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [makeContext("async-roundtrip-context")],
      };

      await fake.writeManifest("/path/manifest.yaml", originalManifest);
      const readResult = await fake.readManifest("/path/manifest.yaml");

      if (readResult.success) {
        assert.deepStrictEqual(readResult.data, originalManifest);
      } else {
        assert.fail("Expected success but got error in round-trip test");
      }
    });
  });

  describe("test control methods", () => {
    it("should clear all stored manifests and reset counters on clear()", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      fake.writeManifestSync("/path/manifest.yaml", testManifest);
      fake.readManifestSync("/path/manifest.yaml");
      fake.setFailWriteOnNext();

      assert.strictEqual(fake.hasManifest("/path/manifest.yaml"), true);
      assert.strictEqual(fake.getReadCount(), 1);
      assert.strictEqual(fake.getWriteCount(), 1);

      fake.clear();

      assert.strictEqual(fake.hasManifest("/path/manifest.yaml"), false);
      assert.strictEqual(fake.getReadCount(), 0);
      assert.strictEqual(fake.getWriteCount(), 0);
    });

    it("should reset counters but keep stored data on reset()", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      fake.writeManifestSync("/path/manifest.yaml", testManifest);
      fake.readManifestSync("/path/manifest.yaml");

      assert.strictEqual(fake.hasManifest("/path/manifest.yaml"), true);
      assert.strictEqual(fake.getReadCount(), 1);

      fake.reset();

      assert.strictEqual(fake.hasManifest("/path/manifest.yaml"), true);
      assert.strictEqual(fake.getReadCount(), 0);
    });

    it("should allow inspection of stored content via getStoredContent()", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      fake.writeManifestSync("/path/manifest.yaml", testManifest);

      const content = fake.getStoredContent("/path/manifest.yaml");

      assert.ok(content !== null);
      assert.strictEqual(typeof content, "string");
    });

    it("should return null for non-existent manifest via getStoredContent()", async () => {
      const result = fake.getStoredContent("/nonexistent/path/manifest.yaml");

      assert.strictEqual(result, null);
    });
  });

  describe("test double parity", () => {
    it("should have same method signatures as real adapter for sync operations", async () => {
      // Verify interface parity - methods exist and return correct types
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      const writeResult = fake.writeManifestSync(
        "/path/manifest.yaml",
        testManifest,
      );

      assert.ok("success" in writeResult);
      if (!writeResult.success) {
        assert.ok("error" in writeResult && writeResult.error instanceof Error);
      }

      const readResult = fake.readManifestSync("/path/manifest.yaml");
      assert.ok("success" in readResult);
    });

    it("should have same method signatures as real adapter for async operations", async () => {
      // Verify interface parity - methods exist and return correct types
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [],
      };

      const writeResult = await fake.writeManifest(
        "/path/manifest.yaml",
        testManifest,
      );

      assert.ok("success" in writeResult);
      if (!writeResult.success) {
        assert.ok("error" in writeResult && writeResult.error instanceof Error);
      }

      const readResult = await fake.readManifest("/path/manifest.yaml");
      assert.ok("success" in readResult);
    });

    it("should expose test-control methods not present on real adapter", async () => {
      // These methods exist ONLY on the fake (per test double convention)
      assert.strictEqual(typeof fake.setFailWriteOnNext, "function");
      assert.strictEqual(typeof fake.setFailReadOnNext, "function");
      assert.strictEqual(typeof fake.clear, "function");
      assert.strictEqual(typeof fake.reset, "function");
      assert.strictEqual(typeof fake.getReadCount, "function");
      assert.strictEqual(typeof fake.getWriteCount, "function");
      assert.strictEqual(typeof fake.hasManifest, "function");
      assert.strictEqual(typeof fake.getStoredContent, "function");
    });
  });

  describe("edge cases", () => {
    it("should handle empty bounded_contexts array", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [], // Empty but valid
      };

      const result = fake.writeManifestSync(
        "/path/manifest.yaml",
        testManifest,
      );

      assert.strictEqual(result.success, true);
    });

    it("should handle manifest with complex port structures", async () => {
      const testManifest: Manifest = {
        version: "1.0.0",
        bounded_contexts: [
          makeContext("complex-context", {
            in: ["port-1", "port-3"],
            out: ["port-2"],
          }),
        ],
      };

      const result = fake.writeManifestSync(
        "/path/manifest.yaml",
        testManifest,
      );

      assert.strictEqual(result.success, true);

      const readResult = fake.readManifestSync("/path/manifest.yaml");
      if (readResult.success) {
        const contexts = readResult.data.bounded_contexts ?? [];
        assert.strictEqual(contexts.length, 1);
        const applicationPorts = contexts[0]?.layers?.application?.ports;
        assert.strictEqual(
          (applicationPorts?.in?.length ?? 0) +
            (applicationPorts?.out?.length ?? 0),
          3,
        );
      } else {
        assert.fail("Expected success but got error");
      }
    });

    it("should handle multiple manifests at different paths", async () => {
      const manifest1: Manifest = {
        version: "1.0.0",
        bounded_contexts: [makeContext("context-1")],
      };

      const manifest2: Manifest = {
        version: "2.0.0",
        bounded_contexts: [makeContext("context-2")],
      };

      fake.writeManifestSync("/path/manifest1.yaml", manifest1);
      fake.writeManifestSync("/path/manifest2.yaml", manifest2);

      assert.strictEqual(fake.hasManifest("/path/manifest1.yaml"), true);
      assert.strictEqual(fake.hasManifest("/path/manifest2.yaml"), true);

      const result1 = fake.readManifestSync("/path/manifest1.yaml");
      const result2 = fake.readManifestSync("/path/manifest2.yaml");

      if (result1.success && result2.success) {
        assert.deepStrictEqual(result1.data, manifest1);
        assert.deepStrictEqual(result2.data, manifest2);
      } else {
        assert.fail("Expected success but got error");
      }
    });
  });
});
