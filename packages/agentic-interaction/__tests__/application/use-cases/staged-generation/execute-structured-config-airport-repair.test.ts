import { describe, it, vi } from "vitest";
import assert from "node:assert";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type {
  Transaction,
  TransactionManagerPort,
  TransactionStatus,
} from "@hexagen/transaction-system";

// `Transaction` timestamps are epoch millis and there is no `lineage` field —
// the previous inline literal used `Date` objects and an extra `lineage: []`,
// which only survived because this file was never type-checked (AUD-020).
function makeTransaction(
  id: string,
  status: TransactionStatus = "pending",
): Transaction {
  const now = Date.now();
  return {
    id,
    intentId: "i",
    status,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

const mockTransactionManager: TransactionManagerPort = {
  begin: vi.fn(() => makeTransaction("tx")),
  transition: vi.fn((id: string, status: TransactionStatus) =>
    makeTransaction(id, status),
  ),
  get: vi.fn(() => null),
  list: vi.fn(() => []),
  commit: vi.fn(() => null),
  rollback: vi.fn(() => null),
  fail: vi.fn(() => null),
  compareAndSetStatus: vi.fn(() => null),
};

// Stages 3/4 get a non-port response -> 0 ports/adapters parsed, so the
// orchestrator's DETERMINISTIC fallback derives ports from the spec's aggregates
// (repository) + use_cases (inbound). Stage 6 reads it as a passing LLM verdict,
// so the only error is the DETERMINISTIC R01 (banned context name).
function llmPortPassingValidation(): SendStructuredRequestPort {
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

// AI-GENERATED-PORT spec: NO `layers` / pre-defined ports. `payment-gateway`
// trips the deterministic R01 banned-context rule ("gateway"); the aggregate +
// use case give the fallback something to derive ports from.
const airportSpec = [
  "bounded_contexts:",
  "  - name: payment-gateway",
  "    aggregates:",
  "      - { name: Payment, root: true }",
  "use_cases:",
  "  payment-gateway:",
  "    - { name: ProcessPayment }",
  "context_mappings: []",
  "",
].join("\n");

describe("ExecuteStructuredConfigGenerationUseCase — R01 auto-resolve on an AI-generated-port spec", () => {
  it("renames the banned context at the source and the domain survives the rename", async () => {
    // R01 is resolved deterministically at Stage 0 (`payment-gateway` → `payment`)
    // — no reviewer needed. The Stage-0 rename touches only the context name, so
    // the Payment aggregate (and the fallback-derived ports built around the clean
    // name) stay attached. Domain-survival guard (PR #344), now at the source.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      llmPortPassingValidation(),
      mockTransactionManager,
    );
    const result = await useCase.execute(airportSpec, { onProgress: () => {} });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(!result.validation.errors.some((e) => e.includes("R01")));
      const parsed = result.value.parsedObject as {
        bounded_contexts?: Array<{
          name: string;
          layers?: { domain?: { entities?: string[] } };
        }>;
      };
      const payment = parsed.bounded_contexts?.find(
        (c) => c.name === "payment",
      );
      assert.ok(payment, "renamed context 'payment' must be present");
      assert.ok(
        !parsed.bounded_contexts?.some((c) => c.name === "payment-gateway"),
      );
      assert.ok(
        payment?.layers?.domain?.entities?.includes("Payment"),
        "the Payment aggregate must survive the rename",
      );
    }
  });
});
