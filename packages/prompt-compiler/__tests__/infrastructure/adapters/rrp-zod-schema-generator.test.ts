import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { RRPZodSchemaGeneratorAdapter } from "../../../src/infrastructure/adapters/rrp-zod-schema-generator.adapter.js";
import type { GenerateZodSchemaRequest } from "../../../src/application/ports/in/generate-zod-schema.port.js";

describe("RRPZodSchemaGeneratorAdapter", () => {
  let adapter: RRPZodSchemaGeneratorAdapter;

  beforeEach(() => {
    adapter = new RRPZodSchemaGeneratorAdapter();
  });

  describe("generate()", () => {
    it("should generate schema from compiled contract", async () => {
      const request: GenerateZodSchemaRequest = {
        name: "UserSchema",
        description: "Schema for user data",
        exampleData: { name: "John", age: 30, active: true },
        compiledContract: {
          name: "UserSchema",
          description: "Schema for user data",
          fields: {
            name: { type: "string", required: true },
            age: { type: "number", required: true },
            active: { type: "boolean", required: false },
          },
          constraints: {},
          authorizedBy: "governance-policy-v1",
        },
      };

      const result = await adapter.generate(request);

      assert.ok(result.schema !== undefined);
      assert.match(result.id, /^rrp-zod-schema-/);
      assert.strictEqual(result.version, 1);
    });

    it("should validate example data against contract", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const request: GenerateZodSchemaRequest = {
        name: "TestSchema",
        description: "Test schema",
        exampleData: { name: "John", age: "not-a-number" },
        compiledContract: {
          name: "TestSchema",
          description: "Test schema",
          fields: {
            name: { type: "string", required: true },
            age: { type: "number", required: true },
          },
          constraints: {},
          authorizedBy: "test-policy",
        },
      };

      await adapter.generate(request);

      assert.ok(consoleSpy.mock.calls.length > 0);
      const warnMessage = consoleSpy.mock.calls[0][0] as string;
      assert.ok(
        warnMessage.includes(
          "[Zod] Example data failed validation against contract",
        ),
      );
      consoleSpy.mockRestore();
    });

    it("should fall back to type inference when no contract provided", async () => {
      const request: GenerateZodSchemaRequest = {
        name: "InferredSchema",
        description: "Schema inferred from example",
        exampleData: "example string",
      };

      const result = await adapter.generate(request);

      assert.ok(result.schema !== undefined);
      assert.match(result.id, /^rrp-zod-schema-/);
    });

    it("should be backward compatible with example data only", async () => {
      const request: GenerateZodSchemaRequest = {
        name: "LegacySchema",
        description: "Legacy schema",
        exampleData: { field1: "value" },
      };

      const result = await adapter.generate(request);

      assert.ok(result.schema !== undefined);
      assert.strictEqual(result.version, 1);
      assert.ok(result.updatedAt !== undefined);
    });

    it("should handle optional fields in contract", async () => {
      const request: GenerateZodSchemaRequest = {
        name: "OptionalSchema",
        description: "Schema with optional fields",
        exampleData: { required: "value" },
        compiledContract: {
          name: "OptionalSchema",
          description: "Schema with optional fields",
          fields: {
            required: { type: "string", required: true },
            optional: { type: "string", required: false },
          },
          constraints: {},
          authorizedBy: "test-policy",
        },
      };

      const result = await adapter.generate(request);

      const validation = result.schema.safeParse({ required: "value" });
      assert.strictEqual(validation.success, true);

      const validationWithOptional = result.schema.safeParse({
        required: "value",
        optional: "also value",
      });
      assert.strictEqual(validationWithOptional.success, true);
    });

    it("should handle multiple field types in contract", async () => {
      const request: GenerateZodSchemaRequest = {
        name: "MultiTypeSchema",
        description: "Schema with multiple field types",
        exampleData: {
          stringField: "text",
          numberField: 42,
          booleanField: true,
          arrayField: ["item1", "item2"],
        },
        compiledContract: {
          name: "MultiTypeSchema",
          description: "Schema with multiple field types",
          fields: {
            stringField: { type: "string", required: true },
            numberField: { type: "number", required: true },
            booleanField: { type: "boolean", required: true },
            arrayField: { type: "array", required: true },
          },
          constraints: {},
          authorizedBy: "test-policy",
        },
      };

      const result = await adapter.generate(request);
      const validation = result.schema.safeParse(request.exampleData);

      assert.strictEqual(validation.success, true);
    });

    it("should infer string type from example", async () => {
      const request: GenerateZodSchemaRequest = {
        name: "StringSchema",
        description: "String schema",
        exampleData: "test string",
      };

      const result = await adapter.generate(request);
      const validation = result.schema.safeParse("another string");

      assert.strictEqual(validation.success, true);
    });

    it("should infer number type from example", async () => {
      const request: GenerateZodSchemaRequest = {
        name: "NumberSchema",
        description: "Number schema",
        exampleData: 42,
      };

      const result = await adapter.generate(request);
      const validation = result.schema.safeParse(100);

      assert.strictEqual(validation.success, true);
    });
  });
});
