import { describe, it } from "node:test";
import assert from "node:assert";
import { ok, err } from "@hexagen/shared";
import { LLMProviderSelectorAdapter } from "../../../src/infrastructure/adapters/llm-provider-selector.adapter.js";
import type { LLMRequest, LLMResponse } from "@hexagen/local-llm";

// Mock functions and adapters
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
      } as LLMResponse
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
      error: new Error("Local LLM failed")
    };
  },
  streamStructuredRequest: async function* () {
    yield { success: false, error: new Error("Local LLM stream failed") };
  },
  getLoadedModel: () => null,
  hasModelInCache: async () => false,
};

const mockCloudAdapter = {
  sendRequest: async () => {
    return {
      success: true,
      value: {
        id: "cloud-123",
        modelId: "mock-cloud-model",
        content: JSON.stringify({ result: "Generated from cloud LLM" }),
        finishReason: "stop",
        timestamp: Date.now(),
      } as LLMResponse
    };
  },
  streamStructuredRequest: async function* () {
    yield { success: true, value: "cloud chunk 1" };
    yield { success: true, value: "cloud chunk 2" };
  },
};

// Mock the CloudLLMPipelineAdapter for testing
jest.mock("../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter.js", () => {
  return {
    CloudLLMPipelineAdapter: jest.fn().mockImplementation(() => {
      return mockCloudAdapter;
    }),
  };
});

describe("LLMProviderSelectorAdapter", () => {
  it("should use local LLM when available and preferred", async () => {
    const adapter = new LLMProviderSelectorAdapter({
      webLlmAdapter: mockLocalLLMAdapter as any,
      preferLocal: true,
      validateLocalLLM: true,
      fallbackChain: { 
        primary: {
          providerId: "test",
          model: "test-model",
          apiKeyEnvVar: "TEST_API_KEY",
          baseUrl: "https://example.com",
        },
        fallbacks: []
      },
      secretVault: { getSecret: async () => "fake-secret" } as any,
    });

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
        "Generated from local LLM"
      );
    }
  });

  it("should fall back to cloud when local LLM fails", async () => {
    const adapter = new LLMProviderSelectorAdapter({
      webLlmAdapter: mockFailingLocalLLMAdapter as any,
      preferLocal: true,
      validateLocalLLM: true,
      fallbackChain: { 
        primary: {
          providerId: "test",
          model: "test-model",
          apiKeyEnvVar: "TEST_API_KEY",
          baseUrl: "https://example.com",
        },
        fallbacks: []
      },
      secretVault: { getSecret: async () => "fake-secret" } as any,
    });

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const result = await adapter.sendRequest(request);
    
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.modelId, "mock-cloud-model");
      assert.strictEqual(
        JSON.parse(result.value.content).result,
        "Generated from cloud LLM"
      );
    }
  });

  it("should use cloud when local is not preferred", async () => {
    const adapter = new LLMProviderSelectorAdapter({
      webLlmAdapter: mockLocalLLMAdapter as any,
      preferLocal: false,  // Prefer cloud
      validateLocalLLM: true,
      fallbackChain: { 
        primary: {
          providerId: "test",
          model: "test-model",
          apiKeyEnvVar: "TEST_API_KEY",
          baseUrl: "https://example.com",
        },
        fallbacks: []
      },
      secretVault: { getSecret: async () => "fake-secret" } as any,
    });

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const result = await adapter.sendRequest(request);
    
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.modelId, "mock-cloud-model");
      assert.strictEqual(
        JSON.parse(result.value.content).result,
        "Generated from cloud LLM"
      );
    }
  });

  it("should use cloud when local adapter is not available", async () => {
    const adapter = new LLMProviderSelectorAdapter({
      webLlmAdapter: null,  // No local adapter
      preferLocal: true,
      validateLocalLLM: true,
      fallbackChain: { 
        primary: {
          providerId: "test",
          model: "test-model",
          apiKeyEnvVar: "TEST_API_KEY",
          baseUrl: "https://example.com",
        },
        fallbacks: []
      },
      secretVault: { getSecret: async () => "fake-secret" } as any,
    });

    const request: LLMRequest = {
      modelId: "mock-local-model",
      messages: [{ role: "user", content: "Generate something" }],
      schema: { type: "object", properties: {} },
    };

    const result = await adapter.sendRequest(request);
    
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.modelId, "mock-cloud-model");
      assert.strictEqual(
        JSON.parse(result.value.content).result,
        "Generated from cloud LLM"
      );
    }
  });
  
  it("should stream from local LLM when available and preferred", async () => {
    const adapter = new LLMProviderSelectorAdapter({
      webLlmAdapter: mockLocalLLMAdapter as any,
      preferLocal: true,
      validateLocalLLM: true,
      fallbackChain: { 
        primary: {
          providerId: "test",
          model: "test-model",
          apiKeyEnvVar: "TEST_API_KEY",
          baseUrl: "https://example.com",
        },
        fallbacks: []
      },
      secretVault: { getSecret: async () => "fake-secret" } as any,
    });

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
    const adapter = new LLMProviderSelectorAdapter({
      webLlmAdapter: mockFailingLocalLLMAdapter as any,
      preferLocal: true,
      validateLocalLLM: true,
      fallbackChain: { 
        primary: {
          providerId: "test",
          model: "test-model",
          apiKeyEnvVar: "TEST_API_KEY",
          baseUrl: "https://example.com",
        },
        fallbacks: []
      },
      secretVault: { getSecret: async () => "fake-secret" } as any,
    });

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
    
    assert.deepStrictEqual(chunks, ["cloud chunk 1", "cloud chunk 2"]);
  });
});