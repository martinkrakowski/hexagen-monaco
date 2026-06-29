import { describe, it, vi } from "vitest";
import assert from "node:assert";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { TransactionManagerPort } from "@hexagen/transaction-system";

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
} as unknown as TransactionManagerPort;

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

// Two contexts where the repair RE-INTRODUCES an adapter-name collision:
//   - orders.PlaceOrderPort has no adapter → R05 (deterministicBefore = 1).
//   - fulfillment already declares a PlaceOrderAdapter (unbound — none of its
//     ports stem-match, so it's harmless and adds no error).
// The repair adds PlaceOrderAdapter to orders to clear R05 → the repaired
// manifest now has PlaceOrderAdapter in BOTH contexts. The repair-path dedupe
// must make them globally unique.
const collisionSpec = [
  "bounded_contexts:",
  "  - name: orders",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [PlaceOrderPort]",
  "          out: [OrdersRepositoryPort]",
  "      infrastructure:",
  "        adapters: [OrdersRepositoryAdapter]",
  "  - name: fulfillment",
  "    layers:",
  "      application:",
  "        ports:",
  "          in: [ShipOrderPort]",
  "          out: [ShipmentRepositoryPort]",
  "      infrastructure:",
  "        adapters: [ShipOrderAdapter, ShipmentRepositoryAdapter, PlaceOrderAdapter]",
  "use_cases: {}",
  "context_mappings: []",
  "",
].join("\n");

// AI-generated-port spec: no pre-defined `layers.application.ports`, so Stage 3
// runs (here via the stage-aware mock below). The repository port is NAMED
// "ScenePersistence" — Stage 3 types it `repository`, but the rendered manifest
// carries only the name, and buildPreDefinedPortMap re-infers it as
// "external-client" (no Repository/Repo suffix). That mismatch is what made the
// Stage-7 gate's before (Stage-3 basis) and after (reassembly basis) counts
// incomparable. See docs/planning/stage7-repair-rca-and-remediation.md.
const aiSpec = [
  "bounded_contexts:",
  "  - name: scene",
  "    description: Manages the 3D scene lifecycle and persistence",
  "use_cases: {}",
  "context_mappings: []",
  "",
].join("\n");

// A single llmPort drives Stages 3/4/6 (0/1/2 are deterministic for a config
// import); discriminate by each stage's system-prompt opening.
function stageAwarePort(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: (request: {
      messages?: Array<{ content?: string }>;
    }) => {
      const sys = String(request?.messages?.[0]?.content ?? "");
      let payload = '{"type":"result","passed":true}\n';
      if (sys.includes("defining ports and context mappings")) {
        // RenderScenePort (inbound, left unbound → R05) + ScenePersistence
        // (outbound, typed repository but with a non-inferable name).
        payload =
          '{"contextName":"scene","direction":"in","name":"RenderScenePort","portType":"command","description":"Renders the scene from a validated configuration"}\n' +
          '{"contextName":"scene","direction":"out","name":"ScenePersistence","portType":"repository","description":"Persists the scene aggregate across sessions"}\n';
      } else if (sys.includes("adapter architect")) {
        // Bind ONLY the repository port; RenderScenePort stays unbound → R05.
        payload =
          JSON.stringify({
            contextName: "scene",
            name: "ScenePersistenceAdapter",
            adapterType: "Repository",
            implements: "ScenePersistence",
          }) + "\n";
      } else if (sys.includes("adversarial architectural linter")) {
        payload =
          '{"type":"error","rule":"R05","message":"Inbound port RenderScenePort lacks an adapter"}\n' +
          '{"type":"result","passed":false}\n';
      }
      async function* gen() {
        yield { success: true, value: payload };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

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

  it("dedupes an adapter name a repair re-introduces across contexts (R12 on the repaired manifest)", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6WithOneError(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-adapter","context":"orders","name":"PlaceOrderAdapter"}]',
      ),
    );
    const result = await useCase.execute(collisionSpec, {
      onProgress: () => {},
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.repair?.applied, true);
      const parsed = result.value.parsedObject as {
        bounded_contexts?: Array<{
          layers?: { infrastructure?: { adapters?: string[] } };
        }>;
      };
      const allAdapters = (parsed.bounded_contexts ?? []).flatMap(
        (c) => c.layers?.infrastructure?.adapters ?? [],
      );
      // The collision the repair re-introduced must be resolved.
      assert.strictEqual(
        new Set(allAdapters).size,
        allAdapters.length,
        `adapter names must be globally unique after an accepted repair, got: ${allAdapters.join(", ")}`,
      );
      // …and the repair-path rename is surfaced as an advisory.
      const renameWarning =
        result.validation.warnings.find((w) => w.includes("Renamed adapter")) ??
        "(no repair-path rename advisory found)";
      assert.match(renameWarning, /Renamed adapter .* \(R12\)/);
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

  it("preserves the LLM's R08 on an accepted repair (deterministic R08 is masked)", async () => {
    // The assembler always fills system/scope, so the deterministic recount never
    // re-fires R08; stripping R01–R09 would drop the LLM's R08 and flip
    // passed→true. R08 must survive an accepted repair.
    const stage6 = {
      sendRequest: async () => ({ success: true, value: { content: "" } }),
      streamStructuredRequest: () => {
        async function* gen() {
          yield {
            success: true,
            value:
              '{"type":"error","rule":"R05","message":"Inbound port lacks an adapter"}\n' +
              '{"type":"error","rule":"R08","message":"Workspace name is not meaningful"}\n' +
              '{"type":"result","passed":false}\n',
          };
        }
        return gen();
      },
    } as unknown as SendStructuredRequestPort;
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6,
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
        result.validation.errors.some((e) => e.includes("R08")),
        "accepted repair must preserve the LLM's R08, not strip it",
      );
      assert.strictEqual(result.validation.passed, false);
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

  it("auto-resolves R01 by deterministically renaming the banned context at the source", async () => {
    // R01 is now stripped at Stage 0 (`payment-gateway` → `payment`), so it never
    // reaches Stage 6/7 — no reviewer needed; it surfaces as an adjustment warning
    // like R12/R03. (Supersedes the old Stage-7 rename-context-for-R01 path.)
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      passingStage6Port(),
      mockTransactionManager,
    );
    const result = await useCase.execute(bannedConfig, {
      onProgress: () => {},
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(!result.validation.errors.some((e) => e.includes("R01")));
      assert.ok(
        result.validation.warnings.some(
          (w) =>
            w.includes("Renamed context 'payment-gateway' to 'payment'") &&
            w.includes("R01"),
        ),
        "the rename must surface as an adjustment",
      );
      const parsed = result.value.parsedObject as {
        bounded_contexts?: Array<{ name: string }>;
      };
      assert.ok(parsed.bounded_contexts?.some((c) => c.name === "payment"));
      assert.ok(
        !parsed.bounded_contexts?.some((c) => c.name === "payment-gateway"),
      );
    }
  });

  it("is byte-identical (no repair field) when no reviewer is configured", async () => {
    // A surfaced R05 (judge) + no reviewer → no repair, original kept.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6WithOneError(),
      mockTransactionManager,
    );
    const result = await useCase.execute(cleanSpec, {
      onProgress: () => {},
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.repair, undefined);
      // The original report still carries the R05 error.
      assert.ok(result.validation.errors.some((e) => e.includes("R05")));
    }
  });

  it("keeps the original when an applied edit does not reduce findings", async () => {
    // The op applies cleanly (adds an out-port) but doesn't fix the R05 →
    // deterministic gate: adding a port with no adapter ADDS an R04 error
    // → errorsAfter (2) > errorsBefore (1) → no-error-reduction keeps original.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6WithOneError(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-out-port","context":"orders","name":"AuditRepositoryPort"}]',
      ),
    );
    const result = await useCase.execute(cleanSpec, {
      onProgress: () => {},
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.repair);
      assert.strictEqual(result.repair?.applied, false);
      assert.ok(result.validation.errors.some((e) => e.includes("R05")));
    }
  });

  it("keeps the original when every op targets an unknown context (all skipped)", async () => {
    // The op set can only add/rename — it cannot delete a context or shrink the
    // structure (the old "drop a context to shed a finding" gaming vector is
    // impossible by construction). An op for a non-existent context is skipped →
    // no edits applied → the original is kept untouched.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stage6WithOneError(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-adapter","context":"ghost-context","name":"GhostAdapter"}]',
      ),
    );
    const result = await useCase.execute(cleanSpec, {
      onProgress: () => {},
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.repair);
      assert.strictEqual(result.repair?.applied, false);
      assert.ok(result.validation.errors.some((e) => e.includes("R05")));
    }
  });

  it("applies a legit repair on an AI-generated-port manifest — before/after on the same (reassembly) basis", async () => {
    // Regression for the Stage-7 gate measurement divergence. "ScenePersistence"
    // is typed `repository` by Stage 3 (so the in-memory mergedPortMap has no
    // R03), but the rendered manifest re-infers it as external-client → a phantom
    // R03. The repair adds the missing RenderScene adapter, clearing the real
    // R05. Measuring "before" on the Stage-3 basis (R05 only = 1) and "after" on
    // the reassembly basis (R03 phantom = 1) made the gate see 1 ≥ 1 and REJECT a
    // valid repair. Measuring BOTH on the reassembly basis (before R03+R05 = 2,
    // after R03 = 1) accepts it.
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      stageAwarePort(),
      mockTransactionManager,
      undefined,
      undefined,
      reviewerEmittingOps(
        '[{"op":"add-adapter","context":"scene","name":"RenderSceneAdapter"}]',
      ),
    );
    const result = await useCase.execute(aiSpec, { onProgress: () => {} });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.repair, "repair should have been attempted");
      assert.strictEqual(
        result.repair?.applied,
        true,
        "a real repair must be APPLIED — before/after must share the reassembly basis",
      );
      // before counts the phantom R03 too (reassembly basis) — under the old
      // Stage-3 basis this was 1, and the repair was wrongly rejected.
      assert.strictEqual(result.repair?.errorsBefore, 2);
      assert.strictEqual(result.repair?.errorsAfter, 1);
      const parsed = result.value.parsedObject as {
        bounded_contexts?: Array<{
          name: string;
          layers?: { infrastructure?: { adapters?: string[] } };
        }>;
      };
      const scene = parsed.bounded_contexts?.find((c) => c.name === "scene");
      assert.ok(
        scene?.layers?.infrastructure?.adapters?.includes("RenderSceneAdapter"),
        "the repair's added adapter must be in the applied manifest",
      );
    }
  });
});
