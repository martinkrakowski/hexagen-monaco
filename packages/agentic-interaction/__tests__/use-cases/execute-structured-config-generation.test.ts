import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { ExecuteStructuredConfigGenerationUseCase } from "../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.js";
import {
  buildDomainAnalysisFromConfig,
  buildClassificationFromConfig,
  buildNormalizedPromptFromConfig,
} from "../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.js";

function createMockSendStructuredRequest(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({
      success: true,
      value: { content: "{}" },
    }),
    streamStructuredRequest: async function* () {
      yield {
        success: true,
        value: JSON.stringify({
          contextName: "billing",
          direction: "in",
          name: "ProcessBillingPort",
          portType: "command",
          description: "Process billing",
        }),
      };
      yield {
        success: true,
        value: JSON.stringify({
          contextName: "billing",
          direction: "out",
          name: "BillingRepository",
          portType: "repository",
          description: "Persist billing",
        }),
      };
      yield {
        success: true,
        value: JSON.stringify({
          contextName: "billing",
          adapterName: "InMemoryBillingRepoAdapter",
          adapterType: "Repository",
          implements: "BillingRepository",
        }),
      };
      yield {
        success: true,
        value: JSON.stringify({ type: "result", passed: true }),
      };
    },
  } as unknown as SendStructuredRequestPort;
}

describe("ExecuteStructuredConfigGenerationUseCase", () => {
  it("rejects invalid JSON config", async () => {
    const mockPort = createMockSendStructuredRequest();
    const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);
    const result = await useCase.execute("not valid json");
    assert.strictEqual(result.success, false);
  });

  it("returns success for valid structured config JSON", async () => {
    const mockPort = createMockSendStructuredRequest();
    const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);
    const config = {
      bounded_contexts: [{ id: "ctx1", name: "billing" }],
      use_cases: [{ id: "uc1", name: "Process Billing", context_id: "ctx1" }],
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
    const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);
    const config = {
      bounded_contexts: [{ id: "ctx1", name: "billing" }],
      use_cases: [{ id: "uc1", name: "Process Billing", context_id: "ctx1" }],
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
      bounded_contexts: [
        { id: "ctx1", name: "billing" },
        { id: "ctx2", name: "inventory" },
      ],
      use_cases: [{ id: "uc1", name: "Process Billing", context_id: "ctx1" }],
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
      bounded_contexts: [{ id: "ctx1", name: "billing" }],
      use_cases: [],
      context_mappings: [],
    };
    const classification = buildClassificationFromConfig(config);
    assert.strictEqual(classification.accepted.length, 1);
    assert.strictEqual(classification.accepted[0].name, "billing");
    assert.strictEqual(classification.accepted[0].type, "core");
  });

  it("returns empty accepted for empty bounded_contexts", () => {
    const config = {
      bounded_contexts: [],
      use_cases: [],
      context_mappings: [],
    };
    const classification = buildClassificationFromConfig(config);
    assert.strictEqual(classification.accepted.length, 0);
  });
});

describe("buildNormalizedPromptFromConfig", () => {
  it("builds intent from context names", () => {
    const config = {
      bounded_contexts: [{ id: "ctx1", name: "billing" }],
      use_cases: [],
      context_mappings: [],
    };
    const prompt = buildNormalizedPromptFromConfig(config);
    assert.ok(prompt.intent.includes("billing"));
    assert.deepStrictEqual(prompt.explicitTechnologies, []);
    assert.deepStrictEqual(prompt.explicitPatterns, []);
    assert.deepStrictEqual(prompt.ambiguities, []);
  });
});
