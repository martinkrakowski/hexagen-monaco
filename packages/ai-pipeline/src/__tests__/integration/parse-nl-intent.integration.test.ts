/**
 * Integration tests for NL parsing pipeline
 */

import { ParseNLIntentUseCase } from "../../application/use-cases/parse-nl-intent.use-case.js";
import { NLToDomainCommandParserAdapter } from "../../infrastructure/adapters/nl-to-domain-command.adapter.js";
import { NodeKind, EdgeKind } from "@hexagen/core-domain";

describe("NL Intent Parsing - Integration Tests", () => {
  let useCase: ParseNLIntentUseCase;

  beforeEach(() => {
    const adapter = new NLToDomainCommandParserAdapter();
    useCase = new ParseNLIntentUseCase(adapter);
  });

  describe("End-to-End Parsing Flows", () => {
    it("should parse bounded context creation and return typed command", async () => {
      const result = await useCase.execute(
        "Add a bounded context named payment_processing",
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      const parsed = result.value;
      expect(parsed.commands).toHaveLength(1);

      const cmd = parsed.commands[0];
      expect(cmd.type).toBe("CreateNode");
      if (cmd.type === "CreateNode") {
        expect(cmd.payload.kind).toBe(NodeKind.BoundedContext);
        expect(cmd.payload.attributes.name).toBe("payment_processing");
      }
    });

    it("should parse entity creation with correct context binding", async () => {
      const result = await useCase.execute(
        "Add an entity named Transaction to PaymentProcessing",
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      if (cmd.type === "CreateNode") {
        expect(cmd.payload.kind).toBe(NodeKind.Entity);
        expect(cmd.payload.attributes.parentContext).toBe("PaymentProcessing");
      }
    });

    it("should parse use case creation", async () => {
      const result = await useCase.execute(
        "Add a use case named AuthorizePayment to PaymentProcessing",
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      if (cmd.type === "CreateNode") {
        expect(cmd.payload.kind).toBe(NodeKind.UseCase);
        expect(cmd.payload.attributes.name).toBe("AuthorizePayment");
      }
    });

    it("should parse link creation between contexts", async () => {
      const result = await useCase.execute(
        "Create a link from PaymentProcessing to NotificationService",
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      expect(cmd.type).toBe("CreateEdge");
      if (cmd.type === "CreateEdge") {
        expect(cmd.payload.kind).toBe(EdgeKind.Link);
        expect(cmd.payload.source).toBe("PaymentProcessing");
        expect(cmd.payload.target).toBe("NotificationService");
      }
    });

    it("should parse rename operation", async () => {
      const result = await useCase.execute(
        "Rename PaymentContext to PaymentProcessing",
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      expect(cmd.type).toBe("UpdateNode");
      if (cmd.type === "UpdateNode") {
        expect(cmd.payload.attributes.name).toBe("PaymentProcessing");
      }
    });

    it("should parse port creation with context binding", async () => {
      const result = await useCase.execute(
        "Add a port to PaymentProcessing named PaymentGateway",
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      if (cmd.type === "CreateNode") {
        expect(cmd.payload.kind).toBe(NodeKind.Port);
        expect(cmd.payload.attributes.parentContext).toBe("PaymentProcessing");
      }
    });
  });

  describe("ParsedIntent Consistency", () => {
    it("should maintain consistency between originalText and parsed commands", async () => {
      const intent = "Add a bounded context named OrderManagement";
      const result = await useCase.execute(intent);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.originalText).toBe(intent);
        expect(result.value.commands).toHaveLength(1);
        expect(result.value.confidence).toBeGreaterThan(0);
      }
    });

    it("should handle multiple different intent types sequentially", async () => {
      const intents = [
        "Add a bounded context named Billing",
        "Add a bounded context named Shipping",
        "Create a link from Billing to Shipping",
      ];

      for (const intent of intents) {
        const result = await useCase.execute(intent);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.commands.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("Error Recovery", () => {
    it("should recover gracefully from unsupported intent", async () => {
      const result1 = await useCase.execute("Add a bounded context named A");
      expect(result1.success).toBe(true);

      const result2 = await useCase.execute("Some gibberish");
      expect(result2.success).toBe(false);

      const result3 = await useCase.execute("Add a bounded context named B");
      expect(result3.success).toBe(true);
    });

    it("should provide helpful suggestions on parse failure", async () => {
      const result = await useCase.execute("I want to add something");

      expect(result.success).toBe(false);
      if (!result.success && result.error.innerError) {
        expect(result.error.innerError.suggestions).toBeDefined();
        expect(result.error.innerError.suggestions?.length).toBeGreaterThan(0);
      }
    });
  });
});
