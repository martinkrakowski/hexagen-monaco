import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  coerceRawTopology,
  coerceRawPorts,
  coerceContextName,
  coercePortName,
} from "../../../src/domain/manifest/coerce-raw-topology";

describe("coerceContextName", () => {
  it("converts PascalCase to kebab-case", () => {
    assert.strictEqual(
      coerceContextName("ContentManagement"),
      "content-management",
    );
  });

  it("handles consecutive capitals (HTTPAdapter)", () => {
    assert.strictEqual(coerceContextName("HTTPAdapter"), "http-adapter");
  });

  it("handles camelCase (UserAccounts)", () => {
    assert.strictEqual(coerceContextName("UserAccounts"), "user-accounts");
  });

  it("handles IOPort", () => {
    assert.strictEqual(coerceContextName("IOPort"), "io-port");
  });

  it("leaves already kebab-case unchanged", () => {
    assert.strictEqual(
      coerceContextName("order-management"),
      "order-management",
    );
  });

  it("replaces non-kebab chars with hyphens", () => {
    assert.strictEqual(
      coerceContextName("order management"),
      "order-management",
    );
  });
});

describe("coercePortName", () => {
  it("adds Port suffix when missing", () => {
    assert.strictEqual(coercePortName("CreateOrder"), "CreateOrderPort");
  });

  it("leaves name unchanged when Port suffix present", () => {
    assert.strictEqual(coercePortName("CreateOrderPort"), "CreateOrderPort");
  });
});

describe("coerceRawPorts", () => {
  it("adds Port suffix to all port names", () => {
    const input = {
      in: [{ name: "CreateOrder", type: "UseCase", description: "Creates" }],
      out: [{ name: "OrderRepo", type: "Repository", description: "Persists" }],
    };
    const result = coerceRawPorts(input);
    assert.strictEqual(result.in[0].name, "CreateOrderPort");
    assert.strictEqual(result.out[0].name, "OrderRepoPort");
  });

  it("does not double-add Port suffix", () => {
    const input = {
      in: [
        { name: "CreateOrderPort", type: "UseCase", description: "Creates" },
      ],
      out: [],
    };
    const result = coerceRawPorts(input);
    assert.strictEqual(result.in[0].name, "CreateOrderPort");
  });

  it("defaults missing type to use-case for inbound ports", () => {
    const input = {
      in: [{ name: "CreateOrder", type: "", description: "Creates" }],
      out: [],
    };
    const result = coerceRawPorts(input);
    assert.strictEqual(result.in[0].type, "use-case");
  });

  it("defaults missing type to infrastructure for outbound ports", () => {
    const input = {
      in: [],
      out: [{ name: "OrderRepo", type: "", description: "Persists" }],
    };
    const result = coerceRawPorts(input);
    assert.strictEqual(result.out[0].type, "infrastructure");
  });

  it("defaults missing description to generated text", () => {
    const input = {
      in: [{ name: "CreateOrder", type: "UseCase", description: "" }],
      out: [],
    };
    const result = coerceRawPorts(input);
    assert.strictEqual(result.in[0].description, "CreateOrder port");
  });

  it("handles model output with missing fields", () => {
    const input = {
      in: [{ name: "CreateOrder" } as Record<string, unknown>],
      out: [
        { name: "OrderRepo", type: "Repository" } as Record<string, unknown>,
      ],
    };
    const result = coerceRawPorts(input as unknown);
    assert.strictEqual(result.in[0].type, "use-case");
    assert.strictEqual(result.in[0].description, "CreateOrder port");
    assert.strictEqual(result.out[0].type, "Repository"); // provided type is kept
    assert.strictEqual(result.out[0].description, "OrderRepo port");
  });
});

describe("coerceRawTopology", () => {
  it("fixes context names and port names", () => {
    const input = [
      {
        name: "ContentManagement",
        type: "core" as const,
        description: "Manages content",
        ports: {
          in: [
            {
              name: "CreatePost",
              type: "UseCase",
              description: "Creates a post",
            },
          ],
          out: [],
        },
      },
    ];
    const result = coerceRawTopology(input);
    assert.strictEqual(result[0].name, "content-management");
    assert.strictEqual(result[0].ports!.in[0].name, "CreatePostPort");
  });

  it("handles missing ports gracefully", () => {
    const input = [
      {
        name: "Orders",
        type: "core" as const,
        description: "Order management",
      },
    ];
    const result = coerceRawTopology(input);
    assert.strictEqual(result[0].name, "orders");
    assert.strictEqual(result[0].ports, undefined);
  });
});
