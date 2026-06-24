import assert from "node:assert/strict";
import { describe, it, beforeEach } from "vitest";
import { ParseNLIntentUseCase } from "../../application/use-cases/parse-nl-intent.use-case.js";
import { NLToDomainCommandParserAdapter } from "../../infrastructure/adapters/nl-to-domain-command.adapter.js";

describe("ParseNLIntentUseCase", () => {
  let useCase: ParseNLIntentUseCase;
  let adapter: NLToDomainCommandParserAdapter;

  beforeEach(() => {
    adapter = new NLToDomainCommandParserAdapter();
    useCase = new ParseNLIntentUseCase(adapter);
  });

  describe("Valid Intent Parsing", () => {
    it("should successfully parse a bounded context creation intent", async () => {
      const result = await useCase.execute(
        "Add a bounded context named billing",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        const parsed = result.value;
        assert.strictEqual(
          parsed.originalText,
          "Add a bounded context named billing",
        );
        assert.strictEqual(parsed.commands.length, 1);
        assert.ok(parsed.confidence > 0);
        assert.ok(parsed.confidence <= 1);
        assert.ok(parsed.metadata?.tokens !== undefined);
      }
    });

    it("should trim whitespace from intent", async () => {
      const result = await useCase.execute(
        "  Add a bounded context named billing  ",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(
          result.value.originalText,
          "Add a bounded context named billing",
        );
      }
    });

    it("should include tokens in metadata", async () => {
      const result = await useCase.execute(
        "Add a bounded context named payment",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        const tokens = result.value.metadata?.tokens;
        assert.ok(tokens !== undefined);
        assert.ok(tokens!.includes("Add"));
        assert.ok(tokens!.includes("bounded"));
        assert.ok(tokens!.includes("payment"));
      }
    });
  });

  describe("Invalid Intent Handling", () => {
    it("should return error for empty string", async () => {
      const result = await useCase.execute("");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.code, "INVALID_INPUT");
      }
    });

    it("should return error for whitespace-only string", async () => {
      const result = await useCase.execute("   ");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.code, "INVALID_INPUT");
      }
    });

    it("should return PARSER_ERROR for unsupported intent", async () => {
      const result = await useCase.execute("Some nonsense text");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.code, "PARSER_ERROR");
        assert.ok(result.error.innerError !== undefined);
        assert.strictEqual(result.error.innerError?.code, "UNSUPPORTED_INTENT");
      }
    });

    it("should include parser error details in result", async () => {
      const result = await useCase.execute("Random gibberish");

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.message.includes("Could not parse intent"));
        assert.ok(result.error.innerError?.suggestions !== undefined);
      }
    });
  });

  describe("ParsedIntent Value Object", () => {
    it("should create ParsedIntent with all required fields", async () => {
      const result = await useCase.execute(
        "Add a bounded context named inventory",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        const parsed = result.value;
        assert.ok(parsed.originalText !== undefined);
        assert.ok(parsed.commands !== undefined);
        assert.ok(parsed.confidence !== undefined);
        assert.ok(parsed.intentType !== undefined);
        assert.ok(parsed.parameters !== undefined);
        assert.ok(parsed.metadata !== undefined);
      }
    });

    it("should have confidence between 0 and 1", async () => {
      const result = await useCase.execute(
        "Add a bounded context named shipping",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.ok(result.value.confidence >= 0);
        assert.ok(result.value.confidence <= 1);
      }
    });
  });

  describe("Multiple Command Support", () => {
    it("should support parsing multiple related intents (future enhancement)", async () => {
      const result = await useCase.execute(
        "Add a bounded context named billing",
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(Array.isArray(result.value.commands), true);
        assert.ok(result.value.commands.length > 0);
      }
    });
  });
});
