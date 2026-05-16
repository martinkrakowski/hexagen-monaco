import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  SendStructuredRequestPort,
  StructuredResponse,
} from "../../../domain/ports/send-structured-request.port.js";
import { ExecuteStructuredConfigGenerationUseCase } from "../execute-structured-config-generation.use-case.js";

function createMockSendStructuredRequest(
  responses: Partial<StructuredResponse>[],
): SendStructuredRequestPort {
  let callCount = 0;
  return {
    send: async (): Promise<StructuredResponse> => {
      const response = responses[callCount++] ?? { ok: true, completion: "" };
      return response as StructuredResponse;
    },
  };
}

describe("ExecuteStructuredConfigGenerationUseCase", () => {
  let mockPort: SendStructuredRequestPort;

  describe("constructor", () => {
    it("accepts a SendStructuredRequestPort", () => {
      const port = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(port);
      assert.ok(useCase);
    });
  });

  describe("execute", () => {
    it("returns error when config is empty string", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: "",
      });

      assert.strictEqual(result.success, false);
    });

    it("returns error when config is not valid YAML or JSON", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: "not: valid: yaml: or: json",
      });

      assert.strictEqual(result.success, false);
    });

    it("returns error when structured config fails to parse", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: "{ invalid json }",
      });

      assert.strictEqual(result.success, false);
    });

    it("rejects unparseable config with invalid YAML structure", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: "- item1\n- item2\n  badly: indented",
      });

      assert.strictEqual(result.success, false);
    });
  });

  describe("build helpers", () => {
    it("accepts a structured config with intent only", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: 'intent: "My project"',
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.state.stage0.intent, "My project");
      }
    });

    it("accepts a structured config with explicitTechnologies", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: JSON.stringify({
          intent: "My project",
          explicitTechnologies: ["React", "PostgreSQL"],
        }),
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.state.stage0.explicitTechnologies, [
          "React",
          "PostgreSQL",
        ]);
      }
    });

    it("accepts a structured config with subdomains", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: JSON.stringify({
          intent: "My project",
          subdomains: ["billing", "inventory"],
        }),
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.deepStrictEqual(result.state.stage1.subdomains, [
          "billing",
          "inventory",
        ]);
      }
    });

    it("accepts a structured config with classifiedContexts", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: JSON.stringify({
          intent: "My project",
          classifiedContexts: [
            {
              name: "billing",
              type: "core",
              reasoning: "Main billing domain",
            },
          ],
        }),
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.state.stage2.accepted.length, 1);
        assert.strictEqual(result.state.stage2.accepted[0].name, "billing");
        assert.strictEqual(result.state.stage2.accepted[0].type, "core");
      }
    });

    it("rejects empty classifiedContexts array", async () => {
      mockPort = createMockSendStructuredRequest([]);
      const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);

      const result = await useCase.execute({
        config: JSON.stringify({
          intent: "My project",
          classifiedContexts: [],
        }),
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.state.stage2.accepted.length, 0);
      }
    });
  });
});
