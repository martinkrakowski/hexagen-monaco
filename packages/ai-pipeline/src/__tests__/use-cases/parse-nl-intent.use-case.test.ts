/**
 * ParseNLIntentUseCase unit tests
 */

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

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = result.value;
        expect(parsed.originalText).toBe("Add a bounded context named billing");
        expect(parsed.commands).toHaveLength(1);
        expect(parsed.confidence).toBeGreaterThan(0);
        expect(parsed.confidence).toBeLessThanOrEqual(1);
        expect(parsed.metadata?.tokens).toBeDefined();
      }
    });

    it("should trim whitespace from intent", async () => {
      const result = await useCase.execute(
        "  Add a bounded context named billing  ",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.originalText).toBe(
          "Add a bounded context named billing",
        );
      }
    });

    it("should include tokens in metadata", async () => {
      const result = await useCase.execute(
        "Add a bounded context named payment",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const tokens = result.value.metadata?.tokens;
        expect(tokens).toBeDefined();
        expect(tokens).toContain("Add");
        expect(tokens).toContain("bounded");
        expect(tokens).toContain("payment");
      }
    });
  });

  describe("Invalid Intent Handling", () => {
    it("should return error for empty string", async () => {
      const result = await useCase.execute("");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_INPUT");
      }
    });

    it("should return error for whitespace-only string", async () => {
      const result = await useCase.execute("   ");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_INPUT");
      }
    });

    it("should return PARSER_ERROR for unsupported intent", async () => {
      const result = await useCase.execute("Some nonsense text");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("PARSER_ERROR");
        expect(result.error.innerError).toBeDefined();
        expect(result.error.innerError?.code).toBe("UNSUPPORTED_INTENT");
      }
    });

    it("should include parser error details in result", async () => {
      const result = await useCase.execute("Random gibberish");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Could not parse intent");
        expect(result.error.innerError?.suggestions).toBeDefined();
      }
    });
  });

  describe("ParsedIntent Value Object", () => {
    it("should create ParsedIntent with all required fields", async () => {
      const result = await useCase.execute(
        "Add a bounded context named inventory",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = result.value;
        expect(parsed.originalText).toBeDefined();
        expect(parsed.commands).toBeDefined();
        expect(parsed.confidence).toBeDefined();
        expect(parsed.intentType).toBeDefined();
        expect(parsed.parameters).toBeDefined();
        expect(parsed.metadata).toBeDefined();
      }
    });

    it("should have confidence between 0 and 1", async () => {
      const result = await useCase.execute(
        "Add a bounded context named shipping",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.confidence).toBeGreaterThanOrEqual(0);
        expect(result.value.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("Multiple Command Support", () => {
    it("should support parsing multiple related intents (future enhancement)", async () => {
      // This test documents expected future behavior for batch operations
      const result = await useCase.execute(
        "Add a bounded context named billing",
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.value.commands)).toBe(true);
        expect(result.value.commands.length).toBeGreaterThan(0);
      }
    });
  });
});
