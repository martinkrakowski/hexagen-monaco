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

// Stage 7 now emits a JSON OP-LIST (follow-up C), not a manifest. The reviewer
// streams the op-list text back verbatim; the orchestrator parses it and applies
// the ops deterministically to the assembled manifest.
function reviewerEmittingOps(opsJson: string): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: (request: {
      onModelResolved?: (i: unknown) => void;
    }) => {
      request?.onModelResolved?.({ model: "openai/gpt-4o" });
      async function* gen() {
        yield { success: true, value: opsJson };
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

// A call-aware Stage-6 port: emits an [R05] finding on the FIRST validation
// (errorsBefore), then passes on the re-validation — so an additive op that
// "clears" it is exercisable end-to-end. R03/R05/R10 are LLM-judged (only
// R01/R16/R17/R18 are deterministic), hence the two-response mock.
function stage6R05ThenClear(): SendStructuredRequestPort {
  let call = 0;
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: () => {
      call += 1;
      const first = call === 1;
      async function* gen() {
        yield first
          ? {
              success: true,
              value:
                '{"type":"error","rule":"R05","message":"Inbound port lacks an adapter"}\n{"type":"result","passed":false}\n',
            }
          : { success: true, value: '{"type":"result","passed":true}\n' };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

// Clean manifest-shaped spec with pre-defined ports + adapters → Stages 3/4 skip
// the LLM, so the only LLM calls are the two Stage-6 validations (call 1 / call 2).
const cleanSpec = [
  "bounded_contexts:",
  "  - name: orders",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [PlaceOrderPort]",
  "          out: [OrderRepositoryPort]",
  "      infrastructure:",
  "        adapters: [PlaceOrderAdapter]",
  "use_cases: {}",
  "context_mappings: []",
  "",
].join("\n");

describe("ExecuteStructuredConfigGenerationUseCase — Stage 7 verify-and-repair", () => {
  it("applies an ADDITIVE op that clears a finding (R05) — the add/apply path", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6R05ThenClear(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-adapter","context":"orders","name":"ShipOrderAdapter"}]',
      ),
    );
    const result = await useCase.execute(cleanSpec, { onProgress: () => {} });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.repair?.applied, true);
      assert.ok(
        (result.repair?.errorsAfter ?? 1) < (result.repair?.errorsBefore ?? 0),
      );
      assert.strictEqual(result.repair?.errorsAfter, 0);
      const parsed = result.value.parsedObject as {
        bounded_contexts?: Array<{
          name: string;
          layers?: { infrastructure?: { adapters?: string[] } };
        }>;
      };
      const orders = parsed.bounded_contexts?.find((c) => c.name === "orders");
      assert.ok(
        orders?.layers?.infrastructure?.adapters?.includes("ShipOrderAdapter"),
        "the added adapter must be in the applied manifest",
      );
    }
  });

  it("drops an unjustified rename-context but still applies the legit additive op", async () => {
    // No R01 in the baseline → allowContextRename is false. The model emits a
    // gratuitous rename alongside a good add. Without dropping the rename, the
    // gate would reject the WHOLE batch (context drift) and lose the fix.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6R05ThenClear(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"rename-context","from":"orders","to":"order-management"},{"op":"add-adapter","context":"orders","name":"ShipOrderAdapter"}]',
      ),
    );
    const result = await useCase.execute(cleanSpec, { onProgress: () => {} });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.repair?.applied, true);
      const parsed = result.value.parsedObject as {
        bounded_contexts?: Array<{ name: string }>;
      };
      assert.ok(
        parsed.bounded_contexts?.some((c) => c.name === "orders"),
        "the unjustified rename must be dropped — context keeps its name",
      );
      assert.ok(
        !parsed.bounded_contexts?.some((c) => c.name === "order-management"),
      );
    }
  });

  it("applies a rename-context op that clears the banned-name R01", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      passingStage6Port(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"rename-context","from":"payment-gateway","to":"billing"}]',
      ),
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

  it("keeps the original when an applied edit does not reduce findings", async () => {
    // The op applies cleanly (adds a port) but doesn't touch the banned name →
    // re-validation finds the same R01 → gate's no-error-reduction keeps original.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      passingStage6Port(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-out-port","context":"payment-gateway","name":"AuditRepositoryPort"}]',
      ),
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

  it("keeps the original when every op targets an unknown context (all skipped)", async () => {
    // The op set can only add/rename — it cannot delete a context or shrink the
    // structure (the old "drop a context to shed R01" gaming vector is impossible
    // by construction). An op for a non-existent context is skipped → no edits
    // applied → the original is kept untouched.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      passingStage6Port(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-adapter","context":"ghost-context","name":"GhostAdapter"}]',
      ),
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
