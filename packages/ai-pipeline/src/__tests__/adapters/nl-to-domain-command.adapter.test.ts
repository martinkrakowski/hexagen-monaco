/**
 * NLToDomainCommandParserAdapter unit tests
 */

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

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        const cmd = result.value[0];
        expect(cmd.type).toBe("CreateNode");
        if (cmd.type === "CreateNode") {
          expect(cmd.payload.kind).toBe(NodeKind.BoundedContext);
          expect(cmd.payload.attributes.name).toBe("billing");
        }
      }
    });

    it("should handle case-insensitive patterns", async () => {
      const result = await adapter.parse("ADD A BOUNDED CONTEXT NAMED payment");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        const cmd = result.value[0];
        if (cmd.type === "CreateNode") {
          expect(cmd.payload.attributes.name).toBe("payment");
        }
      }
    });

    it("should handle context names with underscores", async () => {
      const result = await adapter.parse(
        "Add a bounded context named order_management",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const cmd = result.value[0];
        if (cmd.type === "CreateNode") {
          expect(cmd.payload.attributes.name).toBe("order_management");
        }
      }
    });
  });

  describe("Create Port Pattern", () => {
    it("should parse 'Add a port to Billing named PaymentService'", async () => {
      const result = await adapter.parse(
        "Add a port to Billing named PaymentService",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        const cmd = result.value[0];
        expect(cmd.type).toBe("CreateNode");
        if (cmd.type === "CreateNode") {
          expect(cmd.payload.kind).toBe(NodeKind.Port);
          expect(cmd.payload.attributes.name).toBe("PaymentService");
          expect(cmd.payload.attributes.parentContext).toBe("Billing");
        }
      }
    });

    it("should default port type to 'inbound' when not specified", async () => {
      const result = await adapter.parse(
        "Add a port to Billing named PaymentService",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const cmd = result.value[0];
        if (cmd.type === "CreateNode") {
          expect(cmd.payload.attributes.portType).toBe("inbound");
        }
      }
    });
  });

  describe("Rename Pattern", () => {
    it("should parse 'Rename oldContext to newContext'", async () => {
      const result = await adapter.parse("Rename oldContext to newContext");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        const cmd = result.value[0];
        expect(cmd.type).toBe("UpdateNode");
        if (cmd.type === "UpdateNode") {
          expect(cmd.payload.attributes).toEqual({ name: "newContext" });
        }
      }
    });
  });

  describe("Create Entity Pattern", () => {
    it("should parse 'Add an entity named Order to Billing'", async () => {
      const result = await adapter.parse(
        "Add an entity named Order to Billing",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        const cmd = result.value[0];
        expect(cmd.type).toBe("CreateNode");
        if (cmd.type === "CreateNode") {
          expect(cmd.payload.kind).toBe(NodeKind.Entity);
          expect(cmd.payload.attributes.name).toBe("Order");
          expect(cmd.payload.attributes.parentContext).toBe("Billing");
        }
      }
    });
  });

  describe("Create UseCase Pattern", () => {
    it("should parse 'Add a use case named ProcessPayment to Billing'", async () => {
      const result = await adapter.parse(
        "Add a use case named ProcessPayment to Billing",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        const cmd = result.value[0];
        expect(cmd.type).toBe("CreateNode");
        if (cmd.type === "CreateNode") {
          expect(cmd.payload.kind).toBe(NodeKind.UseCase);
          expect(cmd.payload.attributes.name).toBe("ProcessPayment");
        }
      }
    });
  });

  describe("Create Link Pattern", () => {
    it("should parse 'Create a link from Billing to Payment'", async () => {
      const result = await adapter.parse(
        "Create a link from Billing to Payment",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        const cmd = result.value[0];
        expect(cmd.type).toBe("CreateEdge");
        if (cmd.type === "CreateEdge") {
          expect(cmd.payload.kind).toBe(EdgeKind.Link);
          expect(cmd.payload.source).toBe("Billing");
          expect(cmd.payload.target).toBe("Payment");
        }
      }
    });
  });

  describe("Error Handling", () => {
    it("should return EMPTY_INPUT error for empty string", async () => {
      const result = await adapter.parse("");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("EMPTY_INPUT");
      }
    });

    it("should return EMPTY_INPUT error for whitespace-only string", async () => {
      const result = await adapter.parse("   ");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("EMPTY_INPUT");
      }
    });

    it("should return UNSUPPORTED_INTENT for unmatched pattern", async () => {
      const result = await adapter.parse("Something completely random");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("UNSUPPORTED_INTENT");
        expect(result.error.suggestions).toBeDefined();
        expect(result.error.suggestions).toHaveLength(5);
      }
    });

    it("should include originalText in error", async () => {
      const intentText = "Invalid intent here";
      const result = await adapter.parse(intentText);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.originalText).toBe(intentText);
      }
    });
  });
});
