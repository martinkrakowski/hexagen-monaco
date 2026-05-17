import test from "node:test";
import assert from "node:assert/strict";
import { ExecuteStructuredConfigGenerationUseCase } from "../execute-structured-config-generation.use-case.js";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";

type StructuredConfig = {
  bounded_contexts: Array<{ id: string; name: string }>;
  use_cases: Array<{ id: string; name: string; context_id: string }>;
  context_mappings: Array<{
    source_context_id: string;
    target_context_id: string;
    mapping_type: string;
  }>;
};

function createMockLLMPort(shouldFailStage3 = false) {
  return {
    sendRequest: async () => ({
      success: true,
      value: { content: JSON.stringify({}) },
    }),
    streamStructuredRequest: async function* () {
      if (shouldFailStage3) {
        yield { success: false, error: "Failed to map ports" };
        return;
      }
      yield {
        success: true,
        value: JSON.stringify({
          contextName: "Payment",
          direction: "in",
          name: "ProcessPaymentPort",
          portType: "command",
          description: "Process a payment",
        }),
      };
      yield {
        success: true,
        value: JSON.stringify({
          contextName: "Payment",
          direction: "out",
          name: "PaymentRepository",
          portType: "repository",
          description: "Persist payment",
        }),
      };
      yield {
        success: true,
        value: JSON.stringify({
          contextName: "Payment",
          adapterName: "InMemoryPaymentRepoAdapter",
          adapterType: "Repository",
          implements: "PaymentRepository",
        }),
      };
      yield {
        success: true,
        value: JSON.stringify({ type: "result", passed: true }),
      };
    },
  } as unknown as SendStructuredRequestPort;
}

test("invalid JSON config → returns { success: false }", async () => {
  const mockPort = createMockLLMPort();
  const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);
  const result = await useCase.execute("invalid json");
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.error);
});

test("valid config → returns { success: true, value: AssembledManifest }", async () => {
  const config: StructuredConfig = {
    bounded_contexts: [{ id: "ctx1", name: "Payment" }],
    use_cases: [{ id: "uc1", name: "Process Payment", context_id: "ctx1" }],
    context_mappings: [
      {
        source_context_id: "ctx1",
        target_context_id: "ctx2",
        mapping_type: "upstream",
      },
    ],
  };
  const mockPort = createMockLLMPort();
  const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);
  const result = await useCase.execute(JSON.stringify(config));
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(typeof result.value.yaml === "string");
    assert.ok(result.value.parsedObject);
  }
});

test("stage 3 (port mapping) failure → returns { success: false }", async () => {
  const config: StructuredConfig = {
    bounded_contexts: [{ id: "ctx1", name: "Payment" }],
    use_cases: [{ id: "uc1", name: "Process Payment", context_id: "ctx1" }],
    context_mappings: [],
  };
  const mockPort = createMockLLMPort(true);
  const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);
  const result = await useCase.execute(JSON.stringify(config));
  assert.equal(result.success, false);
});

test("full flow with callbacks → returns assembled manifest", async () => {
  const config: StructuredConfig = {
    bounded_contexts: [
      { id: "ctx1", name: "Payment" },
      { id: "ctx2", name: "Shipping" },
    ],
    use_cases: [
      { id: "uc1", name: "Process Payment", context_id: "ctx1" },
      { id: "uc2", name: "Ship Order", context_id: "ctx2" },
    ],
    context_mappings: [
      {
        source_context_id: "ctx1",
        target_context_id: "ctx2",
        mapping_type: "upstream-downstream",
      },
    ],
  };
  const mockPort = createMockLLMPort();
  const useCase = new ExecuteStructuredConfigGenerationUseCase(mockPort);
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
