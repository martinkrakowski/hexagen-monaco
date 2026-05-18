import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coerceContextType,
  coerceRawTopology,
  coerceRawPorts,
} from "../../src/domain/manifest/coerce-raw-topology.js";

test("coerce-raw-topology: coerceContextType defaults empty string to core", () => {
  const result = coerceContextType("");
  assert.equal(result, "core");
});

test("coerce-raw-topology: coerceContextType handles null/undefined", () => {
  const result1 = coerceContextType("");
  const result2 = coerceContextType("   ");
  assert.equal(result1, "core");
  assert.equal(result2, "core");
});

test("coerce-raw-topology: coerceContextType accepts valid types", () => {
  assert.equal(coerceContextType("core"), "core");
  assert.equal(coerceContextType("supporting"), "supporting");
  assert.equal(coerceContextType("generic"), "generic");
  assert.equal(coerceContextType("shared-kernel"), "shared-kernel");
});

test("coerce-raw-topology: coerceContextType is case-insensitive", () => {
  assert.equal(coerceContextType("CORE"), "core");
  assert.equal(coerceContextType("Core"), "core");
  assert.equal(coerceContextType("SUPPORTING"), "supporting");
  assert.equal(coerceContextType("GENERIC"), "generic");
});

test("coerce-raw-topology: coerceContextType invalid types default to core", () => {
  assert.equal(coerceContextType("invalid-type"), "core");
  assert.equal(coerceContextType("microservice"), "core");
  assert.equal(coerceContextType("aggregate"), "core");
});

test("coerce-raw-topology: coerceRawTopology applies type coercion", () => {
  const contexts = [
    {
      name: "AuthContext",
      type: "",
      description: "Authentication",
      ports: { in: [], out: [] },
    },
    {
      name: "PaymentContext",
      type: "SUPPORTING",
      description: "Payment processing",
      ports: { in: [], out: [] },
    },
  ];

  const result = coerceRawTopology(contexts);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, "core"); // Empty string -> core
  assert.equal(result[0].name, "auth-context"); // CamelCase -> kebab-case
  assert.equal(result[1].type, "supporting"); // UPPERCASE -> lowercase
  assert.equal(result[1].name, "payment-context");
});

test("coerce-raw-topology: coerceRawPorts applies port name coercion", () => {
  const ports = {
    in: [
      {
        name: "CreateOrder",
        type: "use-case",
        description: "Creates order",
      },
    ],
    out: [
      {
        name: "OrderRepository",
        type: "repository",
        description: "Persists orders",
      },
    ],
  };

  const result = coerceRawPorts(ports);
  assert.equal(result.in[0].name, "CreateOrderPort"); // Adds Port suffix
  assert.equal(result.out[0].name, "OrderRepositoryPort");
});

test("coerce-raw-topology: coerceRawPorts provides defaults for missing fields", () => {
  const ports = {
    in: [{ name: "CreateOrder" }],
    out: [{ name: "OrderRepository" }],
  };

  const result = coerceRawPorts(ports);
  assert.equal(result.in[0].type, "use-case"); // Default type for inbound
  assert.equal(result.out[0].type, "infrastructure"); // Default type for outbound
  assert.ok(result.in[0].description); // Should have description
});

test("coerce-raw-topology: handles empty context type field in real scenario", () => {
  const contexts = [
    {
      name: "OrderContext",
      type: "", // LLM returned empty
      description: "Order management",
      ports: {
        in: [
          {
            name: "CreateOrderPort",
            type: "use-case",
            description: "Create new order",
          },
        ],
        out: [],
      },
    },
  ];

  const result = coerceRawTopology(contexts);
  assert.equal(result[0].type, "core");
  assert.equal(result[0].ports!.in.length, 1);
});

test("coerce-raw-topology: coerceContextType trims whitespace", () => {
  assert.equal(coerceContextType("  core  "), "core");
  assert.equal(coerceContextType("\tsupporting\n"), "supporting");
});

test("coerce-raw-topology: handles mixed valid and invalid types", () => {
  const contexts = [
    { name: "ctx1", type: "core", description: "Valid" },
    { name: "ctx2", type: "", description: "Empty" },
    { name: "ctx3", type: "invalid", description: "Invalid" },
    { name: "ctx4", type: "supporting", description: "Valid" },
  ];

  const result = coerceRawTopology(contexts);
  assert.equal(result[0].type, "core");
  assert.equal(result[1].type, "core"); // Defaults
  assert.equal(result[2].type, "core"); // Defaults
  assert.equal(result[3].type, "supporting");
});

test("coerce-raw-topology: coerceRawPorts handles missing port arrays", () => {
  const result = coerceRawPorts({ in: undefined, out: undefined });
  assert.deepEqual(result.in, []);
  assert.deepEqual(result.out, []);
});

test("coerce-raw-topology: Port name already has Port suffix is not duplicated", () => {
  const ports = {
    in: [{ name: "CreateOrderPort", type: "use-case", description: "Create" }],
    out: [],
  };

  const result = coerceRawPorts(ports);
  assert.equal(result.in[0].name, "CreateOrderPort"); // No double suffix
});
