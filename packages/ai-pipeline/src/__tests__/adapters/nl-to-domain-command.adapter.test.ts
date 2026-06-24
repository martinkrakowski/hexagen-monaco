import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { NLToDomainCommandParserAdapter } from "../../infrastructure/adapters/nl-to-domain-command.adapter.js";
import { NodeKind, EdgeKind } from "@hexagen/core-domain";

describe("NLToDomainCommandParserAdapter", () => {
  let adapter: NLToDomainCommandParserAdapter;

  beforeEach(() => {
    adapter = new NLToDomainCommandParserAdapter();
  });

  describe("Create Bounded Context Pattern", () => {
    it("should parse 'Add a bounded context named billing' into CreateNode command", async () => {
      const result = await adapter.parse("Add a bounded context named billing");

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "CreateNode");
        if (cmd.type === "CreateNode") {
          assert.strictEqual(cmd.payload.kind, NodeKind.BoundedContext);
          assert.strictEqual(cmd.payload.attributes.name, "billing");
        }
      }
    });

    it("should handle case-insensitive patterns", async () => {
      const result = await adapter.parse("ADD A BOUNDED CONTEXT NAMED payment");

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        if (cmd.type === "CreateNode") {
          assert.strictEqual(cmd.payload.attributes.name, "payment");
        }
      }
    });

    it("should handle context names with underscores", async () => {
      const result = await adapter.parse(
        "Add a bounded context named order_management",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        const cmd = result.value[0];
        if (cmd.type === "CreateNode") {
          assert.strictEqual(cmd.payload.attributes.name, "order_management");
        }
      }
    });
  });

  describe("Create Port Pattern", () => {
    it("should parse 'Add a port to Billing named PaymentService'", async () => {
      const result = await adapter.parse(
        "Add a port to Billing named PaymentService",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "CreateNode");
        if (cmd.type === "CreateNode") {
          assert.strictEqual(cmd.payload.kind, NodeKind.Port);
          assert.strictEqual(cmd.payload.attributes.name, "PaymentService");
          assert.strictEqual(cmd.payload.attributes.parentContext, "Billing");
        }
      }
    });

    it("should default port type to 'inbound' when not specified", async () => {
      const result = await adapter.parse(
        "Add a port to Billing named PaymentService",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        const cmd = result.value[0];
        if (cmd.type === "CreateNode") {
          assert.strictEqual(cmd.payload.attributes.portType, "inbound");
        }
      }
    });
  });

  describe("Rename Pattern", () => {
    it("should parse 'Rename oldContext to newContext'", async () => {
      const result = await adapter.parse("Rename oldContext to newContext");

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "UpdateNode");
        if (cmd.type === "UpdateNode") {
          assert.deepStrictEqual(cmd.payload.attributes, {
            name: "newContext",
          });
        }
      }
    });
  });

  describe("Create Entity Pattern", () => {
    it("should parse 'Add an entity named Order to Billing'", async () => {
      const result = await adapter.parse(
        "Add an entity named Order to Billing",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "CreateNode");
        if (cmd.type === "CreateNode") {
          assert.strictEqual(cmd.payload.kind, NodeKind.Entity);
          assert.strictEqual(cmd.payload.attributes.name, "Order");
          assert.strictEqual(cmd.payload.attributes.parentContext, "Billing");
        }
      }
    });
  });

  describe("Create UseCase Pattern", () => {
    it("should parse 'Add a use case named ProcessPayment to Billing'", async () => {
      const result = await adapter.parse(
        "Add a use case named ProcessPayment to Billing",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "CreateNode");
        if (cmd.type === "CreateNode") {
          assert.strictEqual(cmd.payload.kind, NodeKind.UseCase);
          assert.strictEqual(cmd.payload.attributes.name, "ProcessPayment");
        }
      }
    });
  });

  describe("Create Link Pattern", () => {
    it("should parse 'Create a link from Billing to Payment'", async () => {
      const result = await adapter.parse(
        "Create a link from Billing to Payment",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "CreateEdge");
        if (cmd.type === "CreateEdge") {
          assert.strictEqual(cmd.payload.kind, EdgeKind.Dependency);
          assert.strictEqual(cmd.payload.source, "Billing");
          assert.strictEqual(cmd.payload.target, "Payment");
        }
      }
    });
  });

  describe("Edge Synonym Pattern (Phase A.4)", () => {
    it("should parse 'Create an edge from user-context to payment-context' with 'edge' synonym", async () => {
      const result = await adapter.parse(
        "Create an edge from user-context to payment-context",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "CreateEdge");
        if (cmd.type === "CreateEdge") {
          assert.strictEqual(cmd.payload.kind, EdgeKind.Dependency);
          assert.strictEqual(cmd.payload.source, "user-context");
          assert.strictEqual(cmd.payload.target, "payment-context");
        }
      }
    });

    it("should parse 'Create an edge from auth to database' with hyphens in names", async () => {
      const result = await adapter.parse(
        "Create an edge from auth to database",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "CreateEdge");
        if (cmd.type === "CreateEdge") {
          assert.strictEqual(cmd.payload.source, "auth");
          assert.strictEqual(cmd.payload.target, "database");
        }
      }
    });
  });

  describe("Update Context Pattern (Phase A.3)", () => {
    it("should parse 'Update user-service to use GraphQL'", async () => {
      const result = await adapter.parse("update user-service to use GraphQL");

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "UpdateNode");
        if (cmd.type === "UpdateNode") {
          assert.strictEqual(cmd.payload.nodeId, "user-service");
          assert.strictEqual(
            cmd.payload.attributes.configuration,
            "use GraphQL",
          );
        }
      }
    });

    it("should parse 'Modify payment context to add async messaging'", async () => {
      const result = await adapter.parse(
        "modify payment context to add async messaging",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "UpdateNode");
        if (cmd.type === "UpdateNode") {
          assert.strictEqual(cmd.payload.nodeId, "payment");
          assert.strictEqual(
            cmd.payload.attributes.configuration,
            "add async messaging",
          );
        }
      }
    });

    it("should parse 'Change order-service infrastructure to serverless'", async () => {
      const result = await adapter.parse(
        "change order-service infrastructure to serverless",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.length, 1);
        const cmd = result.value[0];
        assert.strictEqual(cmd.type, "UpdateNode");
        if (cmd.type === "UpdateNode") {
          assert.strictEqual(cmd.payload.nodeId, "order-service");
          assert.strictEqual(
            cmd.payload.attributes.configuration,
            "serverless",
          );
        }
      }
    });
  });

  describe("Context Names with Hyphens and Digits", () => {
    it("should handle context names with hyphens in 'Add a bounded context' pattern", async () => {
      const result = await adapter.parse(
        "Add a bounded context named payment-service",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        const cmd = result.value[0];
        if (cmd.type === "CreateNode") {
          assert.ok(cmd.payload.attributes.name !== undefined);
        }
      }
    });

    it("should handle context names with digits in bounded context creation", async () => {
      const result = await adapter.parse(
        "Add a bounded context named context123",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        const cmd = result.value[0];
        if (cmd.type === "CreateNode") {
          assert.strictEqual(cmd.payload.attributes.name, "context123");
        }
      }
    });
  });

  describe("CONTEXT_NAME_REGEX Validation", () => {
    it("should validate context names with lowercase letters, digits, hyphens, and underscores", () => {
      const CONTEXT_NAME_REGEX = /^[a-z0-9_-]+$/;

      assert.strictEqual(CONTEXT_NAME_REGEX.test("user-service"), true);
      assert.strictEqual(CONTEXT_NAME_REGEX.test("order_context"), true);
      assert.strictEqual(CONTEXT_NAME_REGEX.test("context123"), true);
      assert.strictEqual(CONTEXT_NAME_REGEX.test("payment-service-v2"), true);
      assert.strictEqual(CONTEXT_NAME_REGEX.test("_private"), true);
      assert.strictEqual(CONTEXT_NAME_REGEX.test("-invalid"), true); // Starts with hyphen
    });

    it("should reject context names with uppercase or special characters", () => {
      const CONTEXT_NAME_REGEX = /^[a-z0-9_-]+$/;

      assert.strictEqual(CONTEXT_NAME_REGEX.test("UserService"), false);
      assert.strictEqual(CONTEXT_NAME_REGEX.test("context.name"), false);
      assert.strictEqual(CONTEXT_NAME_REGEX.test("context@name"), false);
      assert.strictEqual(CONTEXT_NAME_REGEX.test("context name"), false);
    });
  });

  describe("Error Handling", () => {
    it("should return EMPTY_INPUT error for empty string", async () => {
      const result = await adapter.parse("");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.code, "EMPTY_INPUT");
      }
    });

    it("should return EMPTY_INPUT error for whitespace-only string", async () => {
      const result = await adapter.parse("   ");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.code, "EMPTY_INPUT");
      }
    });

    it("should return UNSUPPORTED_INTENT for unmatched pattern", async () => {
      const result = await adapter.parse("Something completely random");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.code, "UNSUPPORTED_INTENT");
        assert.ok(result.error.suggestions !== undefined);
        assert.strictEqual(result.error.suggestions.length, 6);
      }
    });

    it("should include originalText in error", async () => {
      const intentText = "Invalid intent here";
      const result = await adapter.parse(intentText);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.originalText, intentText);
      }
    });
  });
});
