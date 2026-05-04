import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
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

      assert.strictEqual(result.success, true);
      if (!result.success) throw new Error("Parse failed");

      const parsed = result.value;
      assert.strictEqual(parsed.commands.length, 1);

      const cmd = parsed.commands[0];
      assert.strictEqual(cmd.type, "CreateNode");
      if (cmd.type === "CreateNode") {
        assert.strictEqual(cmd.payload.kind, NodeKind.BoundedContext);
        assert.strictEqual(cmd.payload.attributes.name, "payment_processing");
      }
    });

    it("should parse entity creation with correct context binding", async () => {
      const result = await useCase.execute(
        "Add an entity named Transaction to PaymentProcessing",
      );

      assert.strictEqual(result.success, true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      if (cmd.type === "CreateNode") {
        assert.strictEqual(cmd.payload.kind, NodeKind.Entity);
        assert.strictEqual(
          cmd.payload.attributes.parentContext,
          "PaymentProcessing",
        );
      }
    });

    it("should parse use case creation", async () => {
      const result = await useCase.execute(
        "Add a use case named AuthorizePayment to PaymentProcessing",
      );

      assert.strictEqual(result.success, true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      if (cmd.type === "CreateNode") {
        assert.strictEqual(cmd.payload.kind, NodeKind.UseCase);
        assert.strictEqual(cmd.payload.attributes.name, "AuthorizePayment");
      }
    });

    it("should parse link creation between contexts", async () => {
      const result = await useCase.execute(
        "Create a link from PaymentProcessing to NotificationService",
      );

      assert.strictEqual(result.success, true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      assert.strictEqual(cmd.type, "CreateEdge");
      if (cmd.type === "CreateEdge") {
        assert.strictEqual(cmd.payload.kind, EdgeKind.Dependency);
        assert.strictEqual(cmd.payload.source, "PaymentProcessing");
        assert.strictEqual(cmd.payload.target, "NotificationService");
      }
    });

    it("should parse rename operation", async () => {
      const result = await useCase.execute(
        "Rename PaymentContext to PaymentProcessing",
      );

      assert.strictEqual(result.success, true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      assert.strictEqual(cmd.type, "UpdateNode");
      if (cmd.type === "UpdateNode") {
        assert.strictEqual(cmd.payload.attributes.name, "PaymentProcessing");
      }
    });

    it("should parse port creation with context binding", async () => {
      const result = await useCase.execute(
        "Add a port to PaymentProcessing named PaymentGateway",
      );

      assert.strictEqual(result.success, true);
      if (!result.success) throw new Error("Parse failed");

      const cmd = result.value.commands[0];
      if (cmd.type === "CreateNode") {
        assert.strictEqual(cmd.payload.kind, NodeKind.Port);
        assert.strictEqual(
          cmd.payload.attributes.parentContext,
          "PaymentProcessing",
        );
      }
    });
  });

  describe("ParsedIntent Consistency", () => {
    it("should maintain consistency between originalText and parsed commands", async () => {
      const intent = "Add a bounded context named OrderManagement";
      const result = await useCase.execute(intent);

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.originalText, intent);
        assert.strictEqual(result.value.commands.length, 1);
        assert.ok(result.value.confidence > 0);
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
        assert.strictEqual(result.success, true);
        if (result.success) {
          assert.ok(result.value.commands.length > 0);
        }
      }
    });
  });

  describe("Error Recovery", () => {
    it("should recover gracefully from unsupported intent", async () => {
      const result1 = await useCase.execute("Add a bounded context named A");
      assert.strictEqual(result1.success, true);

      const result2 = await useCase.execute("Some gibberish");
      assert.strictEqual(result2.success, false);

      const result3 = await useCase.execute("Add a bounded context named B");
      assert.strictEqual(result3.success, true);
    });

    it("should provide helpful suggestions on parse failure", async () => {
      const result = await useCase.execute("I want to add something");

      assert.strictEqual(result.success, false);
      if (!result.success && result.error.innerError) {
        assert.ok(result.error.innerError.suggestions !== undefined);
        assert.ok(result.error.innerError.suggestions?.length > 0);
      }
    });
  });
});
