import { test } from "vitest";
import assert from "node:assert/strict";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { TransactionManagerPort } from "@hexagen/transaction-system";

type StructuredConfig = {
  bounded_contexts: Array<{ name: string }>;
  use_cases: Record<string, Array<{ name: string }>>;
  context_mappings: Array<{
    upstream: string;
    downstream: string;
  }>;
};

function createMockLLMPort(shouldFailStage3 = false) {
  let callCount = 0;
  return {
    sendRequest: async () => {
      callCount++;
      if (shouldFailStage3 && callCount >= 3) {
        return {
          success: false as const,
          error: new Error("LLM failure at Stage 3"),
        };
      }
      let content = "";
      if (callCount <= 2) {
        content = [
          JSON.stringify({
            contextName: "Payment",
            direction: "in",
            name: "ProcessPaymentPort",
            portType: "command",
            description: "Process a payment",
          }),
          JSON.stringify({
            contextName: "Payment",
            direction: "out",
            name: "PaymentRepository",
            portType: "repository",
            description: "Persist payment",
          }),
        ].join("\n");
      } else if (callCount <= 4) {
        content = JSON.stringify({
          contextName: "Payment",
          adapterName: "InMemoryPaymentRepoAdapter",
          adapterType: "Repository",
          implements: "PaymentRepository",
        });
      } else {
        content = JSON.stringify({ type: "result", passed: true });
      }
      return {
        success: true as const,
        value: {
          id: `test-${callCount}`,
          modelId: "gpt-4o-mini" as any,
          content,
          finishReason: "stop" as const,
          timestamp: Date.now(),
        },
      };
    },
    streamStructuredRequest: async function* () {
      if (shouldFailStage3) {
        yield { success: false, error: "Failed to map ports" };
        return;
      }
      yield {
        success: true,
        value:
          JSON.stringify({
            contextName: "Payment",
            direction: "in",
            name: "ProcessPaymentPort",
            portType: "command",
            description: "Process a payment",
          }) + "\n",
      };
      yield {
        success: true,
        value:
          JSON.stringify({
            contextName: "Payment",
            direction: "out",
            name: "PaymentRepository",
            portType: "repository",
            description: "Persist payment",
          }) + "\n",
      };
      yield {
        success: true,
        value: JSON.stringify({ type: "result", passed: true }) + "\n",
      };
    },
  } as unknown as SendStructuredRequestPort;
}

function createMockTransactionManager(): TransactionManagerPort {
  const transactions = new Map<string, { id: string; status: string }>();
  return {
    begin: (intentId: string) => {
      const tx = {
        id: `txn-${intentId}`,
        intentId,
        status: "pending" as const,
      };
      transactions.set(tx.id, tx);
      return tx as any;
    },
    transition: (txId: string, status: string) => {
      const tx = transactions.get(txId);
      if (tx) tx.status = status;
      return tx as any;
    },
    get: (txId: string) => (transactions.get(txId) as any) ?? null,
    list: () => Array.from(transactions.values()) as any,
    commit: (txId: string) => {
      const tx = transactions.get(txId);
      if (tx) tx.status = "committed";
      return tx as any;
    },
    rollback: (txId: string) => {
      const tx = transactions.get(txId);
      if (tx) tx.status = "rolled_back";
      return tx as any;
    },
  } as unknown as TransactionManagerPort;
}

test("invalid JSON config → returns { success: false }", async () => {
  const mockPort = createMockLLMPort();
  const mockTxManager = createMockTransactionManager();
  const useCase = new ExecuteStructuredConfigGenerationUseCase(
    mockPort,
    mockTxManager,
  );
  const result = await useCase.execute("invalid json");
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.error);
});

test("valid config → returns { success: true, value: AssembledManifest }", async () => {
  const config: StructuredConfig = {
    bounded_contexts: [{ name: "Payment" }],
    use_cases: { Payment: [{ name: "Process Payment" }] },
    context_mappings: [],
  };
  const mockPort = createMockLLMPort();
  const mockTxManager = createMockTransactionManager();
  const useCase = new ExecuteStructuredConfigGenerationUseCase(
    mockPort,
    mockTxManager,
  );
  const result = await useCase.execute(JSON.stringify(config));
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(typeof result.value.yaml === "string");
    assert.ok(result.value.parsedObject);
    assert.ok(result.transactionId);
  }
});

test("records non-zero context/port/adapter counts in begin() metadata (A2 counts-helper)", async () => {
  // Directly pins the structured-config always-0 fix on THIS path. Before the
  // shared countManifestEntities, this pipeline read ctx.ports/ctx.adapters at
  // the context root (always 0); it now reads the layers.* shape assembly emits.
  // The "Payment" config produces 1 context, 1 in + 1 out port, and 1 adapter.
  const config: StructuredConfig = {
    bounded_contexts: [{ name: "Payment" }],
    use_cases: { Payment: [{ name: "Process Payment" }] },
    context_mappings: [],
  };

  let beginMetadata: Record<string, unknown> | undefined;
  const capturingTxManager = {
    begin: (intentId: string, metadata?: Record<string, unknown>) => {
      beginMetadata = metadata;
      return { id: `txn-${intentId}`, intentId, status: "pending" };
    },
    transition: (txId: string, status: string) => ({ id: txId, status }),
  } as unknown as TransactionManagerPort;

  const useCase = new ExecuteStructuredConfigGenerationUseCase(
    createMockLLMPort(),
    capturingTxManager,
  );
  const result = await useCase.execute(JSON.stringify(config));

  assert.equal(result.success, true);
  assert.ok(beginMetadata, "begin() should have been called with metadata");
  // The load-bearing proof of the fix: the assembled manifest nests these ports
  // under layers.application.ports.{in,out}, so the old context-root read
  // (ctx.ports) recorded portCount 0 here. The shared helper reads the nested
  // path → 2. (adapterCount stays 0: this shared mock's streaming stage-4 emits
  // no adapter into the manifest — the adapter-counting path is covered by the
  // helper's own unit test.)
  assert.equal(beginMetadata.contextCount, 1);
  assert.equal(beginMetadata.portCount, 2);
});

test("stage 3 (port mapping) failure → returns { success: false }", async () => {
  const config: StructuredConfig = {
    bounded_contexts: [{ name: "Payment" }],
    use_cases: { Payment: [{ name: "Process Payment" }] },
    context_mappings: [],
  };
  const mockPort = createMockLLMPort(true);
  const mockTxManager = createMockTransactionManager();
  const useCase = new ExecuteStructuredConfigGenerationUseCase(
    mockPort,
    mockTxManager,
  );
  const result = await useCase.execute(JSON.stringify(config));
  assert.equal(result.success, false);
});

test("onManifestReady fires exactly once, between Stage-5 completion and Stage-6 start (Part B-lite)", async () => {
  const config: StructuredConfig = {
    bounded_contexts: [{ name: "Payment" }],
    use_cases: { Payment: [{ name: "Process Payment" }] },
    context_mappings: [],
  };
  const useCase = new ExecuteStructuredConfigGenerationUseCase(
    createMockLLMPort(),
    createMockTransactionManager(),
  );

  // One shared timeline of onProgress markers + the manifest-ready hook.
  // Stage-5 assembly is synchronous, so its completion duration can be 0ms —
  // ordering is proven positionally against the fixed start/complete protocol
  // (each stage pings (N, 0) then reports (N, duration)), not by duration.
  const events: string[] = [];
  let readyYaml: string | null = null;
  const result = await useCase.execute(JSON.stringify(config), {
    onProgress: (stage) => events.push(`p${stage}`),
    onManifestReady: (manifest) => {
      events.push("manifest-ready");
      readyYaml = manifest.yaml;
    },
  });

  assert.equal(result.success, true);
  const readyIdx = events.indexOf("manifest-ready");
  assert.ok(readyIdx !== -1, "onManifestReady must fire");
  assert.equal(
    events.filter((e) => e === "manifest-ready").length,
    1,
    "onManifestReady must fire exactly once",
  );
  // Both stage-5 progress events (start ping + completion) precede it; every
  // stage-6 progress event follows it.
  assert.equal(
    events.slice(0, readyIdx).filter((e) => e === "p5").length,
    2,
    "stage 5 must have started AND completed before the early manifest",
  );
  assert.equal(
    events.slice(0, readyIdx).filter((e) => e === "p6").length,
    0,
    "stage 6 must not have started before the early manifest",
  );
  assert.equal(events.slice(readyIdx + 1).filter((e) => e === "p6").length, 2);
  // The scripted judge passes, so no Stage-7 repair runs: the early yaml IS
  // the final yaml here (the supersede path is covered by the route tests).
  if (result.success) {
    assert.equal(readyYaml, result.value.yaml);
  }
});

test("full flow with callbacks → returns assembled manifest", async () => {
  const config: StructuredConfig = {
    bounded_contexts: [{ name: "Payment" }, { name: "Shipping" }],
    use_cases: {
      Payment: [{ name: "Process Payment" }],
      Shipping: [{ name: "Ship Order" }],
    },
    context_mappings: [],
  };
  const mockPort = createMockLLMPort();
  const mockTxManager = createMockTransactionManager();
  const useCase = new ExecuteStructuredConfigGenerationUseCase(
    mockPort,
    mockTxManager,
  );
  const progressStages: number[] = [];
  const result = await useCase.execute(JSON.stringify(config), {
    onProgress: (stage) => {
      progressStages.push(stage);
    },
    onError: () => {},
    onChunk: () => {},
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(result.value.yaml.length > 0);
    assert.ok(result.value.parsedObject);
    assert.ok(progressStages.length > 0);
  }
});
