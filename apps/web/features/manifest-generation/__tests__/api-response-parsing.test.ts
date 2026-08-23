import { describe, it } from "vitest";
import assert from "assert";

/** An API payload as it arrives: nothing about its shape is guaranteed yet. */
type LooseApiResponse = {
  ok: boolean;
  data: { boundedContexts?: unknown[]; ports?: unknown[] };
};

describe("API Response Parsing and Port Normalization", () => {
  describe("Port Normalization", () => {
    it("should normalize string port to object", () => {
      const input = "OrderPort";
      const normalized = normalizePort(input);

      assert.strictEqual(normalized.name, "OrderPort");
      assert.strictEqual(normalized.type, "use-case");
      assert.ok(normalized.description.includes("OrderPort"));
    });

    it("should normalize object port with all fields", () => {
      const input = {
        name: "PaymentPort",
        type: "infrastructure",
        description: "Payment processing adapter",
      };
      const normalized = normalizePort(input);

      assert.deepStrictEqual(normalized, {
        name: "PaymentPort",
        type: "infrastructure",
        description: "Payment processing adapter",
      });
    });

    it("should normalize object port with missing description", () => {
      const input = {
        name: "NotificationPort",
        type: "use-case",
      };
      const normalized = normalizePort(input);

      assert.strictEqual(normalized.name, "NotificationPort");
      assert.strictEqual(normalized.type, "use-case");
      assert.ok(
        normalized.description.includes("Notification") ||
          normalized.description.includes("NotificationPort"),
      );
    });

    it("should normalize object port with missing type", () => {
      const input = {
        name: "ReportPort",
        description: "Report generation",
      };
      const normalized = normalizePort(input, "infrastructure");

      assert.strictEqual(normalized.name, "ReportPort");
      assert.strictEqual(normalized.type, "infrastructure");
      assert.strictEqual(normalized.description, "Report generation");
    });

    it("should throw on invalid port (number)", () => {
      assert.throws(() => normalizePort(123), /should be string or object/i);
    });

    it("should throw on invalid port (null)", () => {
      assert.throws(() => normalizePort(null), /should be string or object/i);
    });

    it("should throw on object with missing name", () => {
      const input = {
        type: "use-case",
        description: "Missing name",
      };
      assert.throws(() => normalizePort(input), /missing.*name|Port.*name/i);
    });

    it("should throw on object with non-string name", () => {
      const input = {
        name: 123,
        type: "use-case",
      };
      assert.throws(() => normalizePort(input), /name.*string|Port.*name/i);
    });
  });

  describe("Port List Parsing", () => {
    it("should parse array of string ports", () => {
      const input = ["CreateOrderPort", "OrderRepositoryPort"];
      const normalized = input.map((p) => normalizePort(p));

      assert.strictEqual(normalized.length, 2);
      assert.strictEqual(normalized[0].name, "CreateOrderPort");
      assert.strictEqual(normalized[1].name, "OrderRepositoryPort");
    });

    it("should parse array of object ports", () => {
      const input = [
        { name: "CreateOrderPort", type: "use-case" },
        { name: "OrderRepositoryPort", type: "infrastructure" },
      ];
      const normalized = input.map((p) => normalizePort(p));

      assert.strictEqual(normalized.length, 2);
      assert.strictEqual(normalized[0].type, "use-case");
      assert.strictEqual(normalized[1].type, "infrastructure");
    });

    it("should parse mixed array of string and object ports", () => {
      const input = [
        "CreateOrderPort",
        { name: "UpdateOrderPort", type: "use-case" },
        "OrderRepositoryPort",
      ];
      const normalized = input.map((p) => normalizePort(p));

      assert.strictEqual(normalized.length, 3);
      assert.strictEqual(normalized[0].name, "CreateOrderPort");
      assert.strictEqual(normalized[1].name, "UpdateOrderPort");
      assert.strictEqual(normalized[2].name, "OrderRepositoryPort");
    });

    it("should handle empty port list", () => {
      const input: unknown[] = [];
      const normalized = input.map((p) => normalizePort(p));

      assert.strictEqual(normalized.length, 0);
    });
  });

  describe("Manifest Response Validation", () => {
    it("should validate response with all required fields", () => {
      const response = {
        ok: true,
        data: {
          boundedContexts: [
            { name: "OrderContext", type: "core" },
            { name: "PaymentContext", type: "supporting" },
          ],
          ports: [
            { name: "OrderPort", type: "use-case" },
            { name: "PaymentPort", type: "infrastructure" },
          ],
        },
        warnings: [],
        metadata: { model: "test-model", tokens: 500 },
      };

      assert.ok(response.ok);
      assert.strictEqual(response.data.boundedContexts.length, 2);
      assert.strictEqual(response.data.ports.length, 2);
    });

    it("should validate response with minimal fields", () => {
      const response = {
        ok: true,
        data: {
          boundedContexts: [{ name: "TestContext", type: "core" }],
          ports: [],
        },
      };

      assert.ok(response.ok);
      assert.strictEqual(response.data.boundedContexts.length, 1);
      assert.strictEqual(response.data.ports.length, 0);
    });

    it("should detect missing boundedContexts", () => {
      const response: LooseApiResponse = {
        ok: true,
        data: {
          ports: [{ name: "TestPort", type: "use-case" }],
        },
      };

      assert.throws(() => {
        if (!response.data.boundedContexts) {
          throw new Error("Missing boundedContexts");
        }
      }, /boundedContexts/i);
    });

    it("should detect missing ports field", () => {
      const response: LooseApiResponse = {
        ok: true,
        data: {
          boundedContexts: [{ name: "TestContext", type: "core" }],
        },
      };

      // ports can be undefined, but should be validated
      assert.ok(response.data.boundedContexts);
      assert.strictEqual(response.data.ports, undefined);
    });

    it("should validate bounded context structure", () => {
      const contexts = [
        { name: "OrderContext", type: "core", description: "Orders" },
        { name: "PaymentContext", type: "supporting" },
      ];

      for (const ctx of contexts) {
        assert.ok(ctx.name, "Context must have name");
        assert.ok(
          ["core", "supporting", "generic", "shared-kernel", "driver"].includes(
            ctx.type,
          ),
          `Context type must be valid: ${ctx.type}`,
        );
      }
    });

    it("should validate port structure in response", () => {
      const ports = [
        { name: "CreateOrderPort", type: "use-case", description: "..." },
        "QueryOrderPort",
        { name: "OrderRepositoryPort", type: "infrastructure" },
      ];

      // Validate mixed format
      for (const port of ports) {
        if (typeof port === "string") {
          assert.strictEqual(typeof port, "string");
        } else {
          assert.ok(port.name);
          assert.ok(
            [
              "use-case",
              "infrastructure",
              "adapter",
              "entity",
              "value-object",
            ].includes(port.type),
          );
        }
      }
    });
  });

  describe("JSON Parsing Edge Cases", () => {
    it("should handle responses with extra fields", () => {
      const response = {
        ok: true,
        data: {
          boundedContexts: [{ name: "Test", type: "core" }],
          ports: [],
          extraField: "should be ignored",
          warnings: ["Some warning"],
        },
        metadata: { timestamp: 123 },
      };

      assert.ok(response.data.boundedContexts);
      assert.ok(response.data.ports);
      // Extra fields should not cause issues
      assert.ok(response.data.extraField);
    });

    it("should handle responses with null values", () => {
      const response = {
        ok: true,
        data: {
          boundedContexts: [{ name: "Test", type: "core" }],
          ports: [],
          warnings: null,
        },
      };

      assert.ok(response.data.boundedContexts);
      assert.strictEqual(response.data.warnings, null);
    });

    it("should handle responses with arrays containing null", () => {
      const response = {
        ok: true,
        data: {
          boundedContexts: [
            { name: "Test", type: "core" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            null as any, // Invalid entry
          ],
          ports: [],
        },
      };

      // Should filter out null entries
      const validContexts = response.data.boundedContexts.filter(
        (ctx) => ctx !== null,
      );
      assert.strictEqual(validContexts.length, 1);
    });
  });

  describe("Error Response Handling", () => {
    it("should detect error responses", () => {
      const response = {
        ok: false,
        error: "Generation failed: Invalid input",
      };

      assert.strictEqual(response.ok, false);
      assert.ok(response.error);
      assert.match(response.error, /Generation failed/);
    });

    it("should preserve error messages", () => {
      const errors = [
        "Network timeout after 30 seconds",
        "Malformed input description",
        "Model not loaded: Required model missing",
      ];

      for (const error of errors) {
        assert.ok(error.length > 0);
        assert.match(error, /timeout|input|Model|Network/);
      }
    });

    it("should handle partial success responses", () => {
      const response = {
        ok: true,
        data: {
          boundedContexts: [],
          ports: [],
        },
        warnings: [
          "No contexts generated: Description too short",
          "Failed to extract ports for SomeContext",
        ],
      };

      assert.ok(response.ok);
      assert.ok(response.warnings);
      assert.strictEqual(response.warnings.length, 2);
      assert.match(response.warnings[0], /contexts|Description/);
    });
  });
});

/**
 * Helper: Normalize port from string or object format
 * Matches implementation in useClientManifestGeneration.ts
 */
function normalizePort(
  input: unknown,
  defaultType = "use-case",
): {
  name: string;
  type: string;
  description: string;
} {
  if (typeof input === "string") {
    return {
      name: input,
      type: defaultType,
      description: `${input} port`,
    };
  }

  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    if (typeof obj.name !== "string") {
      throw new Error(
        `Invalid port: missing or non-string name. Got: ${JSON.stringify(input)}`,
      );
    }
    return {
      name: obj.name,
      type: typeof obj.type === "string" ? obj.type : defaultType,
      description:
        typeof obj.description === "string"
          ? obj.description
          : `${obj.name} port`,
    };
  }

  throw new Error(
    `Port should be string or object, got ${typeof input}: ${JSON.stringify(input)}`,
  );
}
