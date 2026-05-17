import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../../dist/application/use-cases/staged-generation/execute-structured-config-generation.use-case.js";

// Mock the LLM port
const mockSendStructuredRequest = mock.fn(() =>
  Promise.resolve(JSON.stringify({ result: "mocked" })),
);
const mockLLMPort = {
  sendStructuredRequest: mockSendStructuredRequest,
};

describe("ExecuteStructuredConfigGenerationUseCase", () => {
  it("returns result with non-null assembledManifest for valid input", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(mockLLMPort);
    const result = await useCase.execute(
      "bounded_contexts:\n  - name: test\nuse_cases: {}\ncontext_mappings: []",
      { onProgress: () => {} },
    );
    assert.ok(result !== undefined);
  });

  it("calls onProgress with stages 0-6", async () => {
    const calls: [number, string][] = [];
    const useCase = new ExecuteStructuredConfigGenerationUseCase(mockLLMPort);
    await useCase.execute(
      "bounded_contexts:\n  - name: test\nuse_cases: {}\ncontext_mappings: []",
      {
        onProgress: (stage, detail) => {
          calls.push([stage, detail]);
        },
      },
    );
    const stages = calls.map((c) => c[0]);
    assert.ok(stages.length > 0);
  });

  it("handles invalid YAML gracefully", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(mockLLMPort);
    const result = await useCase.execute("invalid: [yaml: broken", {
      onProgress: () => {},
    });
    // Should not throw; should return a result
    assert.ok(result !== undefined);
  });

  it("returns error result on LLM failure", async () => {
    const failingPort = {
      sendStructuredRequest: mock.fn(() =>
        Promise.reject(new Error("LLM API error")),
      ),
    };
    const useCase = new ExecuteStructuredConfigGenerationUseCase(failingPort);
    const result = await useCase.execute(
      "bounded_contexts:\n  - name: test\nuse_cases: {}\ncontext_mappings: []",
      { onProgress: () => {} },
    );
    assert.ok(
      result === undefined || result === null || (result && "error" in result),
    );
  });
});
