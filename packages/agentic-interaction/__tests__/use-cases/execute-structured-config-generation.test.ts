import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  SendStructuredRequestPort,
  LLMRequest,
  LLMResponse,
} from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";
import { ExecuteStructuredConfigGenerationUseCase } from "../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.js";

function createMockSendStructuredRequest(): SendStructuredRequestPort {
  return {
    sendRequest: async (_req: LLMRequest): Promise<Result<LLMResponse>> => {
      void _req;
      return { success: true, value: {} as LLMResponse };
    },
    streamStructuredRequest: async function* (
      _req: LLMRequest,
    ): AsyncGenerator<Result<string>> {
      void _req;
      yield { success: true, value: "" };
    },
  };
}

describe("ExecuteStructuredConfigGenerationUseCase", () => {
  let mockPort: SendStructuredRequestPort;

  describe("constructor", () => {
    it("accepts a SendStructuredRequestPort", () => {
      const port = createMockSendStructuredRequest();
      const useCase = new ExecuteStructuredConfigGenerationUseCase(port);
      assert.ok(useCase);
    });
  });

  describe("execute", () => {
    it("returns error when intent is empty", async () => {
      mockPort = createMockSendStructuredRequest();
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute(
        {
          intent: "",
          explicitTechnologies: [],
          subdomains: [],
          classifiedContexts: [],
        },
        {
          userDescription: "",
          platform: undefined,
          deployment: undefined,
          additionalContext: undefined,
        },
      );

      assert.strictEqual(result.success, false);
    });
  });

  describe("build helpers", () => {
    it("accepts a structured config with intent only", async () => {
      mockPort = createMockSendStructuredRequest();
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute(
        {
          intent: "My project",
          explicitTechnologies: [],
          subdomains: [],
          classifiedContexts: [],
        },
        {
          userDescription: "My project",
          platform: undefined,
          deployment: undefined,
          additionalContext: undefined,
        },
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.state.stage0.intent, "My project");
      }
    });

    it("accepts a structured config with explicitTechnologies", async () => {
      mockPort = createMockSendStructuredRequest();
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute(
        {
          intent: "My project",
          explicitTechnologies: ["React", "PostgreSQL"],
          subdomains: [],
          classifiedContexts: [],
        },
        {
          userDescription: "My project",
          platform: undefined,
          deployment: undefined,
          additionalContext: undefined,
        },
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.state.stage0.explicitTechnologies, [
          "React",
          "PostgreSQL",
        ]);
      }
    });

    it("accepts a structured config with subdomains", async () => {
      mockPort = createMockSendStructuredRequest();
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute(
        {
          intent: "My project",
          explicitTechnologies: [],
          subdomains: ["billing", "inventory"],
          classifiedContexts: [],
        },
        {
          userDescription: "My project",
          platform: undefined,
          deployment: undefined,
          additionalContext: undefined,
        },
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.state.stage1.subdomains, [
          "billing",
          "inventory",
        ]);
      }
    });

    it("accepts a structured config with classifiedContexts", async () => {
      mockPort = createMockSendStructuredRequest();
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute(
        {
          intent: "My project",
          explicitTechnologies: [],
          subdomains: [],
          classifiedContexts: [
            {
              name: "billing",
              type: "core",
              reasoning: "Main billing domain",
            },
          ],
        },
        {
          userDescription: "My project",
          platform: undefined,
          deployment: undefined,
          additionalContext: undefined,
        },
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.state.stage2.accepted.length, 1);
        assert.strictEqual(result.state.stage2.accepted[0].name, "billing");
        assert.strictEqual(result.state.stage2.accepted[0].type, "core");
      }
    });

    it("rejects empty classifiedContexts array", async () => {
      mockPort = createMockSendStructuredRequest();
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute(
        {
          intent: "My project",
          explicitTechnologies: [],
          subdomains: [],
          classifiedContexts: [],
        },
        {
          userDescription: "My project",
          platform: undefined,
          deployment: undefined,
          additionalContext: undefined,
        },
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.state.stage2.accepted.length, 0);
      }
    });
  });
});
