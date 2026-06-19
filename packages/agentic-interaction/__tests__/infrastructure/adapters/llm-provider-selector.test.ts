import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { LLMProviderSelectorAdapter } from "../../../src/infrastructure/adapters/llm-provider-selector.adapter";
import type { LLMRequest, LLMResponse } from "@hexagen/local-llm";

const mockLocalLLMAdapter = {
  sendRequest: async () => {
    return {
      success: true,
      value: {
        id: "local-123",
        modelId: "mock-local-model",
        content: JSON.stringify({ result: "Generated from local LLM" }),
        finishReason: "stop",
        timestamp: Date.now(),
      } as LLMResponse,
    };
  },
  streamStructuredRequest: async function* () {
    yield { success: true, value: "chunk 1" };
    yield { success: true, value: "chunk 2" };
  },
  getLoadedModel: () => ({
    id: "mock-local-model",
    name: "Mock Local Model",
    description: "A mock local model for testing",
    vramRequirements: {
      minimum: 4,
      recommended: 8,
    },
  }),
  hasModelInCache: async () => true,
};

const mockFailingLocalLLMAdapter = {
  sendRequest: async () => {
    return {
      success: false,
      error: new Error("Local LLM failed"),
    };
  },
  streamStructuredRequest: async function* () {
    yield { success: false, error: new Error("Local LLM stream failed") };
  },
  getLoadedModel: () => null,
  hasModelInCache: async () => false,
};

function createCloudMockFetchFn(streamChunks?: string[]) {
  return async (url: string, options: any) => {
    const body = JSON.parse(options.body);

    if (body.stream) {
      const encoder = new TextEncoder();
      const chunks = streamChunks ?? ["cloud chunk 1", "cloud chunk 2"];
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
              ),
            );
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ result: "Generated from cloud LLM" }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
}

function createTestConfig(overrides: {
  webLlmAdapter: any;
  preferLocal: boolean;
  fetchFn?: any;
}) {
  return {
    webLlmAdapter: overrides.webLlmAdapter as any,
    preferLocal: overrides.preferLocal,
    validateLocalLLM: true,
    fallbackChain: {
      primary: {
        providerId: "test",
        model: "test-model",
        apiKeyEnvVar: "TEST_API_KEY",
        baseUrl: "https://example.com",
      },
      fallbacks: [],
    },
    secretVault: { getSecret: () => "fake-secret" } as any,
    fetchFn: overrides.fetchFn ?? createCloudMockFetchFn(),
  };
}

describe("LLMProviderSelectorAdapter", () => {
  it("should use local LLM when available and preferred", async () => {
    const adapter = new LLMProviderSelectorAdapter(
      createTestConfig({
        webLlmAdapter: mockLocalLLMAdapter,
        preferLocal: true,
      }),
    );

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const result = await adapter.sendRequest(request);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.modelId, "mock-local-model");
      assert.strictEqual(
        JSON.parse(result.value.content).result,
        "Generated from local LLM",
      );
    }
  });

  it("should fall back to cloud when local LLM fails", async () => {
    const adapter = new LLMProviderSelectorAdapter(
      createTestConfig({
        webLlmAdapter: mockFailingLocalLLMAdapter,
        preferLocal: true,
      }),
    );

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const result = await adapter.sendRequest(request);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.modelId, "test-model");
      assert.strictEqual(
        JSON.parse(result.value.content).result,
        "Generated from cloud LLM",
      );
    }
  });

  it("should use cloud when local is not preferred", async () => {
    const adapter = new LLMProviderSelectorAdapter(
      createTestConfig({
        webLlmAdapter: mockLocalLLMAdapter,
        preferLocal: false,
      }),
    );

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const result = await adapter.sendRequest(request);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.modelId, "test-model");
      assert.strictEqual(
        JSON.parse(result.value.content).result,
        "Generated from cloud LLM",
      );
    }
  });

  it("should use cloud when local adapter is not available", async () => {
    const adapter = new LLMProviderSelectorAdapter(
      createTestConfig({
        webLlmAdapter: null,
        preferLocal: true,
      }),
    );

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const result = await adapter.sendRequest(request);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.modelId, "test-model");
      assert.strictEqual(
        JSON.parse(result.value.content).result,
        "Generated from cloud LLM",
      );
    }
  });

  it("should stream from local LLM when available and preferred", async () => {
    const adapter = new LLMProviderSelectorAdapter(
      createTestConfig({
        webLlmAdapter: mockLocalLLMAdapter,
        preferLocal: true,
      }),
    );

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const chunks: string[] = [];
    for await (const chunk of adapter.streamStructuredRequest(request)) {
      if (chunk.success) {
        chunks.push(chunk.value);
      }
    }

    assert.deepStrictEqual(chunks, ["chunk 1", "chunk 2"]);
  });

  it("should fall back to cloud streaming when local LLM streaming fails", async () => {
    const adapter = new LLMProviderSelectorAdapter(
      createTestConfig({
        webLlmAdapter: mockFailingLocalLLMAdapter,
        preferLocal: true,
      }),
    );

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const chunks: string[] = [];
    for await (const chunk of adapter.streamStructuredRequest(request)) {
      if (chunk.success) {
        chunks.push(chunk.value);
      }
    }

    assert.ok(chunks.length >= 1);
    assert.strictEqual(chunks[0], "cloud chunk 1");
  });
});
