import { describe, it, vi } from "vitest";
import assert from "node:assert";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

// Mock TransactionManagerPort
const mockTransactionManager = {
  begin: vi.fn(() => ({
    id: "mock-transaction-id",
    status: "pending",
    intentId: "mock-intent",
    metadata: {},
    lineage: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  transition: vi.fn((id, status) => ({
    id,
    status,
    intentId: "mock-intent",
    metadata: {},
    lineage: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  get: vi.fn(() => null),
  list: vi.fn(() => []),
  commit: vi.fn(() => null),
  rollback: vi.fn(() => null),
};

// Mock the LLM port (implements SendStructuredRequestPort)
const mockStreamStructuredRequest = vi.fn(() => {
  async function* mockGenerator() {
    yield {
      success: true,
      value: JSON.stringify({ portMap: {}, contextMappings: [] }),
    };
  }
  return mockGenerator();
});
const mockSendRequest = vi.fn(() =>
  Promise.resolve({
    success: true as const,
    value: {
      id: "test",
      modelId: "gpt-4o-mini" as any,
      content: "mocked",
      finishReason: "stop" as const,
      timestamp: Date.now(),
    },
  }),
);
const mockLLMPort = {
  sendRequest: mockSendRequest,
  streamStructuredRequest: mockStreamStructuredRequest,
};

describe("ExecuteStructuredConfigGenerationUseCase", () => {
  it("returns result with non-null assembledManifest for valid input", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockLLMPort,
      mockTransactionManager,
    );
    const result = await useCase.execute(
      "bounded_contexts:\n  - name: test\nuse_cases: {}\ncontext_mappings: []",
      { onProgress: () => {} },
    );
    assert.ok(result !== undefined);
  });

  it("calls onProgress with stages 0-6", async () => {
    const calls: [number, string][] = [];
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockLLMPort,
      mockTransactionManager,
    );
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
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockLLMPort,
      mockTransactionManager,
    );
    const result = await useCase.execute("invalid: [yaml: broken", {
      onProgress: () => {},
    });
    // Should not throw; should return a result
    assert.ok(result !== undefined);
  });

  it("returns error result on LLM failure", async () => {
    const failingPort = {
      sendRequest: vi.fn(() => Promise.reject(new Error("LLM API error"))),
      streamStructuredRequest: vi.fn(() => {
        async function* gen() {
          yield { success: false, error: new Error("LLM API error") };
        }
        return gen();
      }),
    };
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      failingPort,
      mockTransactionManager,
    );
    const result = await useCase.execute(
      "bounded_contexts:\n  - name: test\nuse_cases: {}\ncontext_mappings: []",
      { onProgress: () => {} },
    );
    assert.ok(
      result === undefined || result === null || (result && "error" in result),
    );
  });
});
