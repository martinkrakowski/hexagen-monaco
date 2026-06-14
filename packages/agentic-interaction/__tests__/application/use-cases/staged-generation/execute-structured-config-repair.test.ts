import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";

const mockTransactionManager = {
  begin: mock.fn(() => ({
    id: "mock-transaction-id",
    status: "pending",
    intentId: "mock-intent",
    metadata: {},
    lineage: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  transition: mock.fn((id, status) => ({
    id,
    status,
    intentId: "mock-intent",
    metadata: {},
    lineage: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  get: mock.fn(() => null),
  list: mock.fn(() => []),
  commit: mock.fn(() => null),
  rollback: mock.fn(() => null),
};

// Stage-6 LLM judge always "passes" — the deterministic R01 (banned context
// name) is what drives errorsBefore. The same port backs the re-validation.
function passingStage6Port(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: () => {
      async function* gen() {
        yield { success: true, value: '{"type":"result","passed":true}\n' };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

// Reviewer streams back a (corrected) config verbatim.
function reviewerPortReturning(config: string): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: (request: {
      onModelResolved?: (i: unknown) => void;
    }) => {
      request?.onModelResolved?.({ model: "openai/gpt-4o" });
      async function* gen() {
        yield { success: true, value: config };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

// Pre-defined ports/adapters so Stages 3/4 skip the LLM — only Stage 6 (and the
// re-validation) touch the mocked port. "payment-gateway" trips the
// deterministic R01 banned-context rule.
const bannedConfig = [
  "bounded_contexts:",
  "  - name: payment-gateway",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [CreatePaymentPort]",
  "          out: [PaymentRepositoryPort]",
  "      infrastructure:",
  "        adapters: [InMemoryPaymentAdapter]",
  "use_cases: {}",
  "context_mappings: []",
  "",
].join("\n");

const repairedConfig = bannedConfig.replace("payment-gateway", "billing");

describe("ExecuteStructuredConfigGenerationUseCase — Stage 7 verify-and-repair", () => {
  it("repairs a banned-context error and re-validates to fewer errors", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      passingStage6Port(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerPortReturning(repairedConfig),
    );
    const result = await useCase.execute(bannedConfig, {
      onProgress: () => {},
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.repair, "repair summary should be present");
      assert.strictEqual(result.repair?.applied, true);
      assert.ok(
        (result.repair?.errorsAfter ?? 1) < (result.repair?.errorsBefore ?? 0),
      );
      assert.strictEqual(result.repair?.errorsAfter, 0);
      // The surfaced report is the RE-VALIDATED one.
      assert.strictEqual(result.validation.errors.length, 0);
    }
  });

  it("is byte-identical (no repair field) when no reviewer is configured", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      passingStage6Port(),
      mockTransactionManager,
    );
    const result = await useCase.execute(bannedConfig, {
      onProgress: () => {},
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.repair, undefined);
      // The original report still carries the R01 error.
      assert.ok(result.validation.errors.some((e) => e.includes("R01")));
    }
  });

  it("keeps the original manifest when the repair does not reduce errors", async () => {
    // Reviewer returns a config that STILL has the banned name → re-validation
    // finds the same error → repair attempted but not applied.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      passingStage6Port(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerPortReturning(bannedConfig),
    );
    const result = await useCase.execute(bannedConfig, {
      onProgress: () => {},
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.repair);
      assert.strictEqual(result.repair?.applied, false);
      assert.ok(result.validation.errors.some((e) => e.includes("R01")));
    }
  });
});
