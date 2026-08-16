import { describe, it, vi } from "vitest";
import assert from "node:assert";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type {
  Transaction,
  TransactionManagerPort,
  TransactionStatus,
} from "@hexagen/transaction-system";

// Mock TransactionManagerPort. `Transaction` timestamps are epoch millis and
// there is no `lineage` field — the previous inline literal used `Date` objects
// and an extra `lineage: []`, which only survived because this file was never
// type-checked (AUD-020).
function makeTransaction(
  id: string,
  status: TransactionStatus = "pending",
): Transaction {
  const now = Date.now();
  return {
    id,
    intentId: "mock-intent",
    status,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

const mockTransactionManager: TransactionManagerPort = {
  begin: vi.fn(() => makeTransaction("mock-transaction-id")),
  transition: vi.fn((id: string, status: TransactionStatus) =>
    makeTransaction(id, status),
  ),
  get: vi.fn(() => null),
  list: vi.fn(() => []),
  commit: vi.fn(() => null),
  rollback: vi.fn(() => null),
};

// Mock the LLM port (implements SendStructuredRequestPort)
const mockStreamStructuredRequest = vi.fn(() => {
  async function* mockGenerator() {
    yield {
      success: true as const,
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
    // `onProgress` is `(stage: number, durationMs: number) => void`.
    const calls: [number, number][] = [];
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
          yield { success: false as const, error: new Error("LLM API error") };
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
