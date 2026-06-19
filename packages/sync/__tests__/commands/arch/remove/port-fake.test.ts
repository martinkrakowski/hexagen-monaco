import assert from "node:assert";
import { describe, it, beforeEach } from "vitest";
import type { Manifest } from "@hexagen/sync";
import { PortRemovalFake } from "./port-fake.js";

describe("PortRemovalFake", () => {
  let fake: PortRemovalFake;

  const createTestManifest = (): Manifest => ({
    system: "test",
    architecture: "modular-monolith",
    bounded_contexts: [
      {
        name: "users",
        type: "core",
        layers: {
          application: {
            ports: {
              in: ["UserServicePort", "UserValidationPort"],
              out: ["DatabasePort"],
            },
          },
        },
      },
      {
        name: "orders",
        type: "core",
        layers: {
          application: {
            ports: {
              in: ["OrderServicePort"],
              out: [],
            },
          },
        },
      },
    ],
  });

  beforeEach(() => {
    fake = new PortRemovalFake();
  });

  describe("removePortFromManifest", () => {
    it("should remove port from context", () => {
      const manifest = createTestManifest();
      const result = fake.removePortFromManifest(
        manifest,
        "users",
        "UserServicePort",
        "in",
      );

      const usersCtx = result.bounded_contexts?.find((c) => c.name === "users");
      assert.deepStrictEqual(usersCtx?.layers?.application?.ports?.in, [
        "UserValidationPort",
      ]);
    });

    it("should increment remove call count", () => {
      const manifest = createTestManifest();
      fake.removePortFromManifest(manifest, "users", "UserServicePort", "in");
      fake.removePortFromManifest(manifest, "orders", "OrderServicePort", "in");

      assert.strictEqual(fake.getRemoveCallCount(), 2);
    });

    it("should track last removal", () => {
      const manifest = createTestManifest();
      fake.removePortFromManifest(manifest, "users", "UserServicePort", "in");

      assert.deepStrictEqual(fake.getLastRemoval(), {
        contextName: "users",
        portName: "UserServicePort",
        direction: "in",
      });
    });

    it("should not modify other contexts", () => {
      const manifest = createTestManifest();
      const result = fake.removePortFromManifest(
        manifest,
        "users",
        "UserServicePort",
        "in",
      );

      const ordersCtx = result.bounded_contexts?.find(
        (c) => c.name === "orders",
      );
      assert.deepStrictEqual(ordersCtx?.layers?.application?.ports?.in, [
        "OrderServicePort",
      ]);
    });

    it("should handle removing non-existent port", () => {
      const manifest = createTestManifest();
      const result = fake.removePortFromManifest(
        manifest,
        "users",
        "NonExistent",
        "in",
      );

      const usersCtx = result.bounded_contexts?.find((c) => c.name === "users");
      assert.deepStrictEqual(usersCtx?.layers?.application?.ports?.in, [
        "UserServicePort",
        "UserValidationPort",
      ]);
    });

    it("should handle removing from out ports", () => {
      const manifest = createTestManifest();
      const result = fake.removePortFromManifest(
        manifest,
        "users",
        "DatabasePort",
        "out",
      );

      const usersCtx = result.bounded_contexts?.find((c) => c.name === "users");
      assert.deepStrictEqual(usersCtx?.layers?.application?.ports?.out, []);
    });

    it("should throw when shouldFail is set", () => {
      const manifest = createTestManifest();
      fake.setShouldFail(true, new Error("Test error"));

      assert.throws(
        () =>
          fake.removePortFromManifest(
            manifest,
            "users",
            "UserServicePort",
            "in",
          ),
        { message: "Test error" },
      );
    });

    it("should reset state", () => {
      const manifest = createTestManifest();
      fake.removePortFromManifest(manifest, "users", "UserServicePort", "in");
      fake.reset();

      assert.strictEqual(fake.getRemoveCallCount(), 0);
      assert.strictEqual(fake.getLastRemoval(), null);
    });
  });
});
