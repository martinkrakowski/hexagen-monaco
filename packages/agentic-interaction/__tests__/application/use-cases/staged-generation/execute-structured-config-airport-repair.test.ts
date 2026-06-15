import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";

const mockTransactionManager = {
  begin: mock.fn(() => ({
    id: "tx",
    status: "pending",
    intentId: "i",
    metadata: {},
    lineage: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  transition: mock.fn((id, status) => ({
    id,
    status,
    intentId: "i",
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

// Stage 7 now emits a JSON OP-LIST (follow-up C), not a manifest. A rename-context
// op is applied DETERMINISTICALLY to the assembled manifest — which for this
// AI-generated-port spec carries the fallback-derived ports AND the Payment
// aggregate under payment-gateway's layers.domain, so the rename moves them to
// `billing` intact.
function renamingReviewer(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: (request: {
      onModelResolved?: (i: unknown) => void;
    }) => {
      request?.onModelResolved?.({ model: "openai/gpt-4o" });
      async function* gen() {
        yield {
          success: true,
          value:
            '[{"op":"rename-context","from":"payment-gateway","to":"billing"}]',
        };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

// AI-GENERATED-PORT spec: NO `layers` / pre-defined ports. `payment-gateway`
// trips the deterministic R01 banned-context rule; the aggregate + use case give
// the fallback something to derive ports from.
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

describe("ExecuteStructuredConfigGenerationUseCase — Stage-7 repair for an AI-generated-port spec", () => {
  it("applies a rename-context op (impossible pre-fix) and the renamed context keeps its domain", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      llmPortPassingValidation(),
      mockTransactionManager,
      undefined,
      undefined,
      renamingReviewer(),
    );
    const result = await useCase.execute(airportSpec, { onProgress: () => {} });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.repair, "a repair should have been attempted");
      assert.strictEqual(
        result.repair?.applied,
        true,
        "the rename op must APPLY (the manifest carries the fallback-derived ports)",
      );
      assert.ok(
        (result.repair?.errorsAfter ?? 1) < (result.repair?.errorsBefore ?? 0),
      );
      // The surfaced manifest + report are the repaired ones: R01 is gone.
      assert.ok(!result.validation.errors.some((e) => e.includes("R01")));

      // Domain-survival guard (PR #344 review): an applied RENAME must not drop
      // the renamed context's domain model. apply-repair-ops renames only the
      // context name; re-validation re-keys stage1 (rekeyDomainAnalysisToManifest)
      // so Stage-5's subdomain match still attaches Payment under the new name.
      const parsed = result.value.parsedObject as {
        bounded_contexts?: Array<{
          name: string;
          layers?: { domain?: { entities?: string[] } };
        }>;
      };
      const billing = parsed.bounded_contexts?.find(
        (c) => c.name === "billing",
      );
      assert.ok(billing, "renamed context 'billing' must be present");
      assert.ok(
        billing?.layers?.domain?.entities?.includes("Payment"),
        "the Payment aggregate must SURVIVE the rename, not be dropped from layers.domain",
      );
    }
  });
});
