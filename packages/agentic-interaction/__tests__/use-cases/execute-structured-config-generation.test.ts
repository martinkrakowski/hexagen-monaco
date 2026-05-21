import { describe, it } from "node:test";
import assert from "node:assert";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import { ExecuteStructuredConfigGenerationUseCase } from "../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import {
  buildDomainAnalysisFromConfig,
  buildClassificationFromConfig,
  buildNormalizedPromptFromConfig,
} from "../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

const portMappingResponse = [
  JSON.stringify({
    contextName: "billing",
    direction: "in",
    name: "ProcessBillingPort",
    portType: "command",
    description: "Process billing",
  }),
  JSON.stringify({
    contextName: "billing",
    direction: "out",
    name: "BillingRepository",
    portType: "repository",
    description: "Persist billing",
  }),
].join("\n");

const adapterResponse = [
  JSON.stringify({
    contextName: "billing",
    adapterName: "InMemoryBillingRepoAdapter",
    adapterType: "Repository",
    implements: "BillingRepository",
  }),
].join("\n");

const validationResponse = JSON.stringify({
  type: "result",
  passed: true,
});

function createMockSendStructuredRequest(): SendStructuredRequestPort {
  let streamCallCount = 0;
  return {
    sendRequest: async () => ({
      success: true as const,
      value: {
        id: "test",
        modelId: "qwen-coder-3b" as any,
        content: portMappingResponse,
        finishReason: "stop" as const,
        timestamp: Date.now(),
      },
    }),
    streamStructuredRequest: () => {
      streamCallCount++;
      let content = portMappingResponse;
      if (streamCallCount > 1 && streamCallCount <= 4)
        content = adapterResponse;
      if (streamCallCount > 4) content = validationResponse;
      return (async function* () {
        yield { success: true, value: content };
      })();
    },
  } as unknown as SendStructuredRequestPort;
}

function createMockTransactionManager(): TransactionManagerPort {
  const transactions = new Map<
    string,
    { id: string; intentId: string; status: string }
  >();
  return {
    begin: (intentId: string) => {
      const tx = { id: `txn-${intentId}`, intentId, status: "pending" };
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

describe("ExecuteStructuredConfigGenerationUseCase", () => {
  it("rejects invalid JSON config", async () => {
    const mockPort = createMockSendStructuredRequest();
    const mockTx = createMockTransactionManager();
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockPort,
      mockTx,
    );
    const result = await useCase.execute("not valid json");
    assert.strictEqual(result.success, false);
  });

  it("returns success for valid structured config JSON", async () => {
    const mockPort = createMockSendStructuredRequest();
    const mockTx = createMockTransactionManager();
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockPort,
      mockTx,
    );
    const config = {
      bounded_contexts: [{ name: "billing" }],
      use_cases: { billing: [{ name: "Process Billing" }] },
      context_mappings: [],
    };
    const result = await useCase.execute(JSON.stringify(config));
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.value.yaml);
      assert.ok(result.value.parsedObject);
    }
  });

  it("invokes onProgress callbacks during stages", async () => {
    const mockPort = createMockSendStructuredRequest();
    const mockTx = createMockTransactionManager();
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      mockPort,
      mockTx,
    );
    const config = {
      bounded_contexts: [{ name: "billing" }],
      use_cases: { billing: [{ name: "Process Billing" }] },
      context_mappings: [],
    };
    const stages: number[] = [];
    const result = await useCase.execute(JSON.stringify(config), {
      onProgress: (stage) => {
        stages.push(stage);
      },
    });
    assert.strictEqual(result.success, true);
    assert.ok(stages.length > 0);
  });
});

describe("buildDomainAnalysisFromConfig", () => {
  it("maps bounded_contexts to nouns/subdomains and use_cases to verbs", () => {
    const config = {
      bounded_contexts: [{ name: "billing" }, { name: "inventory" }],
      use_cases: { billing: [{ name: "Process Billing" }] },
      context_mappings: [],
    };
    const analysis = buildDomainAnalysisFromConfig(config);
    assert.deepStrictEqual(analysis.verbs, ["Process Billing"]);
    assert.deepStrictEqual(analysis.nouns, ["billing", "inventory"]);
    assert.deepStrictEqual(analysis.subdomains, ["billing", "inventory"]);
  });
});

describe("buildClassificationFromConfig", () => {
  it("maps bounded_contexts to accepted core contexts", () => {
    const config = {
      bounded_contexts: [{ name: "billing" }],
      use_cases: {},
      context_mappings: [],
    };
    const classification = buildClassificationFromConfig(
      config,
      buildDomainAnalysisFromConfig(config),
    );
    assert.strictEqual(classification.accepted.length, 1);
    assert.strictEqual(classification.accepted[0].name, "billing");
    assert.strictEqual(classification.accepted[0].type, "core");
  });

  it("returns empty accepted for empty bounded_contexts", () => {
    const config = {
      bounded_contexts: [],
      use_cases: {},
      context_mappings: [],
    };
    const classification = buildClassificationFromConfig(
      config,
      buildDomainAnalysisFromConfig(config),
    );
    assert.strictEqual(classification.accepted.length, 0);
  });
});

describe("buildNormalizedPromptFromConfig", () => {
  it("builds intent from context names", () => {
    const config = {
      bounded_contexts: [{ name: "billing" }],
      use_cases: {},
      context_mappings: [],
    };
    const prompt = buildNormalizedPromptFromConfig(config);
    assert.ok(prompt.intent.includes("billing"));
    assert.deepStrictEqual(prompt.explicitTechnologies, []);
    assert.deepStrictEqual(prompt.explicitPatterns, []);
    assert.deepStrictEqual(prompt.ambiguities, []);
  });
});
