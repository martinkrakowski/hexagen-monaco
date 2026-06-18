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
// name) is what drives errorsBefore for the banned-config tests.
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

// Stage-6 that emits one R05 error — used for the additive-op tests so that
// Stage-7 activates. The deterministic gate now owns the before/after count;
// Stage-6 is only called once (initial review), never for re-validation.
function stage6WithOneError(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: () => {
      async function* gen() {
        yield {
          success: true,
          value:
            '{"type":"error","rule":"R05","message":"Inbound port lacks an adapter"}\n{"type":"result","passed":false}\n',
        };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

// Stage-6 emitting a structural error (engages Stage 7, and the manifest has a
// matching deterministic R05) PLUS a non-deterministic warning (R10) that must
// survive an accepted repair — guards the accept-path report merge.
function stage6WithErrorAndWarning(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: () => {
      async function* gen() {
        yield {
          success: true,
          value:
            '{"type":"error","rule":"R05","message":"Inbound port lacks an adapter"}\n' +
            '{"type":"warning","rule":"R10","message":"Publishes events but has no publisher port"}\n' +
            '{"type":"result","passed":false}\n',
        };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

// Stage 7 emits a JSON OP-LIST (follow-up C), not a manifest. The reviewer
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

// Pre-defined ports/adapters so Stages 3/4 skip the LLM. `payment-gateway`
// trips the deterministic R01 banned-context rule ("gateway" is a delivery token).
// Adapters are chosen so that the name-stemming heuristic (inferAdapterImplements)
// unambiguously maps each adapter to its port — keeping R01 as the SOLE structural
// error before the rename repair. Verified manually:
//   CreatePaymentControllerAdapter  → core "createpayment" → CreatePaymentPort ✓
//   PaymentPersistenceRepositoryAdapter → strip "(Repository)?Adapter" → "PaymentPersistence"
//                                       → core "paymentpersistence" → PaymentPersistenceRepositoryPort ✓
const bannedConfig = [
  "bounded_contexts:",
  "  - name: payment-gateway",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [CreatePaymentPort]",
  "          out: [PaymentPersistenceRepositoryPort]",
  "      infrastructure:",
  "        adapters: [CreatePaymentControllerAdapter, PaymentPersistenceRepositoryAdapter]",
  "use_cases: {}",
  "context_mappings: []",
  "",
].join("\n");

// Pre-defined ports/adapters where PlaceOrderPort (inbound) has NO adapter →
// deterministic R05 error. StockAdapter unambiguously implements StockRepositoryPort:
//   StockAdapter → core "stock" → StockRepositoryPort (portCore "stockrepository" ⊇ "stock")
//   PlaceOrderPort → 0 adapters → R05 error (deterministicBefore = 1)
// After adding PlaceOrderAdapter:
//   PlaceOrderAdapter → core "placeorder" → PlaceOrderPort ✓ → R05 gone (deterministicAfter = 0)
const cleanSpec = [
  "bounded_contexts:",
  "  - name: orders",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [PlaceOrderPort]",
  "          out: [StockRepositoryPort]",
  "      infrastructure:",
  "        adapters: [StockAdapter]",
  "use_cases: {}",
  "context_mappings: []",
  "",
].join("\n");

describe("ExecuteStructuredConfigGenerationUseCase — Stage 7 verify-and-repair", () => {
  it("applies an ADDITIVE op that clears a finding (R05) — the add/apply path", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6WithOneError(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-adapter","context":"orders","name":"PlaceOrderAdapter"}]',
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
        orders?.layers?.infrastructure?.adapters?.includes("PlaceOrderAdapter"),
        "the added adapter must be in the applied manifest",
      );
    }
  });

  it("preserves the review's warnings + non-structural findings on an accepted repair", async () => {
    // Regression guard: replacing finalReport with structural-only on accept
    // dropped the reviewer's warnings (and R10–R18). The repair clears the
    // deterministic R05; the R10 warning must survive into the final report.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6WithErrorAndWarning(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-adapter","context":"orders","name":"PlaceOrderAdapter"}]',
      ),
    );
    const result = await useCase.execute(cleanSpec, { onProgress: () => {} });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.repair?.applied, true);
      assert.strictEqual(result.repair?.errorsAfter, 0); // structural R05 cleared
      assert.ok(
        result.validation.warnings.some((w) => w.includes("R10")),
        "accepted repair must preserve the review's R10 warning, not wipe warnings",
      );
    }
  });

  it("drops an unjustified rename-context but still applies the legit additive op", async () => {
    // No R01 in the baseline → allowContextRename is false. The model emits a
    // gratuitous rename alongside a good add. Without dropping the rename, the
    // gate would reject the WHOLE batch (context drift) and lose the fix.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6WithOneError(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"rename-context","from":"orders","to":"order-management"},{"op":"add-adapter","context":"orders","name":"PlaceOrderAdapter"}]',
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
      // The surfaced report is the deterministic structural report post-repair.
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
    // The op applies cleanly (adds an out-port) but doesn't fix the R01 →
    // deterministic gate: adding a port with no adapter actually ADDS an R04 error
    // → errorsAfter (2) > errorsBefore (1) → no-error-reduction keeps original.
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
