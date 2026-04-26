import assert from "node:assert/strict";
import { CloudLLMPipelineAdapter } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter.js";
import type { CloudLLMPipelineAdapterConfig } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter.js";
import type { ProviderFallbackChain } from "../../../src/domain/provider-config.js";
import { z } from "zod";

function makeRequest(
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: "You are an assistant." },
    { role: "user", content: "Test prompt" },
  ],
) {
  return {
    id: "llm-req-test-1",
    modelId: "gpt-4o-mini" as never,
    messages,
    schema: z.object({ result: z.string() }),
    temperature: 0.4,
    maxTokens: 1024,
  };
}

function makeFetchMock(
  responses: Array<{
    status?: number;
    body?: unknown;
    throw?: Error;
  }>,
) {
  let callIndex = 0;
  return async (_url: string, _opts: RequestInit) => {
    void _url;
    void _opts;
    const resp = responses[callIndex++];
    if (!resp) throw new Error("Unexpected fetch call");
    if (resp.throw) throw resp.throw;
    return {
      ok: (resp.status ?? 200) < 400,
      status: resp.status ?? 200,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    } as Response;
  };
}

const validResponseBody = {
  id: "chatcmpl-test",
  model: "gpt-4o-mini",
  choices: [
    {
      message: {
        role: "assistant",
        content: JSON.stringify({ result: "hello" }),
      },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

const testChain: ProviderFallbackChain = {
  primary: {
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnvVar: "TEST_OPENAI_API_KEY",
    temperature: 0.4,
    maxTokens: 4096,
    timeoutMs: 60000,
  },
  fallbacks: [
    {
      providerId: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-3.5-turbo",
      apiKeyEnvVar: "TEST_OPENAI_FALLBACK_API_KEY",
      temperature: 0.4,
      maxTokens: 4096,
      timeoutMs: 60000,
    },
  ],
};

(async () => {
  // --- Test 1: Successful cloud LLM call ---
  {
    const originalEnv = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-test-key-123";

    try {
      const fetchMock = makeFetchMock([{ body: validResponseBody }]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const result = await adapter.sendRequest(makeRequest());

      assert.ok(result.success, "Should succeed with valid response");
      if (result.success) {
        assert.strictEqual(
          result.value.content,
          JSON.stringify({ result: "hello" }),
        );
        assert.strictEqual(result.value.finishReason, "stop");
        assert.ok(result.value.usage, "Should include usage");
        if (result.value.usage) {
          assert.strictEqual(result.value.usage.totalTokens, 15);
        }
      }
      console.log("✅ Test 1: successful cloud LLM call - passed");
    } finally {
      if (originalEnv !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalEnv;
      else delete process.env.TEST_OPENAI_API_KEY;
    }
  }

  // --- Test 2: No API keys configured ---
  {
    delete process.env.TEST_OPENAI_API_KEY;
    delete process.env.TEST_OPENAI_FALLBACK_API_KEY;

    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: testChain,
      fetchFn: makeFetchMock([]) as typeof fetch,
    };
    const adapter = new CloudLLMPipelineAdapter(config);
    const result = await adapter.sendRequest(makeRequest());

    assert.ok(!result.success, "Should fail when no API keys");
    if (!result.success) {
      assert.ok(
        result.error.message.includes("No cloud LLM API keys configured"),
        "Error should mention missing API keys",
      );
    }
    console.log("✅ Test 2: no API keys configured - passed");
  }

  // --- Test 3: Fallback to secondary provider ---
  {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    const originalFallback = process.env.TEST_OPENAI_FALLBACK_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";
    process.env.TEST_OPENAI_FALLBACK_API_KEY = "sk-fallback";

    try {
      const fetchMock = makeFetchMock([
        { status: 429, body: { error: { message: "Rate limited" } } },
        { body: validResponseBody },
      ]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const result = await adapter.sendRequest(makeRequest());

      assert.ok(result.success, "Should succeed via fallback provider");
      if (result.success) {
        assert.strictEqual(
          result.value.content,
          JSON.stringify({ result: "hello" }),
        );
      }
      console.log("✅ Test 3: fallback to secondary provider - passed");
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
      if (originalFallback !== undefined)
        process.env.TEST_OPENAI_FALLBACK_API_KEY = originalFallback;
      else delete process.env.TEST_OPENAI_FALLBACK_API_KEY;
    }
  }

  // --- Test 4: All providers fail ---
  {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    const originalFallback = process.env.TEST_OPENAI_FALLBACK_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";
    process.env.TEST_OPENAI_FALLBACK_API_KEY = "sk-fallback";

    try {
      const fetchMock = makeFetchMock([
        { status: 500, body: { error: { message: "Internal server error" } } },
        { status: 429, body: { error: { message: "Rate limited" } } },
      ]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const result = await adapter.sendRequest(makeRequest());

      assert.ok(!result.success, "Should fail when all providers fail");
      console.log("✅ Test 4: all providers fail - passed");
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
      if (originalFallback !== undefined)
        process.env.TEST_OPENAI_FALLBACK_API_KEY = originalFallback;
      else delete process.env.TEST_OPENAI_FALLBACK_API_KEY;
    }
  }

  // --- Test 5: Non-retryable error returns immediately ---
  {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";

    try {
      const fetchMock = makeFetchMock([
        { status: 401, body: { error: { message: "Invalid API key" } } },
      ]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const result = await adapter.sendRequest(makeRequest());

      assert.ok(!result.success, "Should fail on auth error");
      if (!result.success) {
        assert.ok(
          result.error.message.includes("401"),
          "Error should include status code",
        );
      }
      console.log(
        "✅ Test 5: non-retryable error returns immediately - passed",
      );
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
    }
  }

  // --- Test 6: Zod schema validation of response ---
  {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";

    try {
      const validSchemaResponse = {
        ...validResponseBody,
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({ result: "validated output" }),
            },
            finish_reason: "stop",
          },
        ],
      };
      const fetchMock = makeFetchMock([{ body: validSchemaResponse }]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const result = await adapter.sendRequest(makeRequest());

      assert.ok(result.success, "Should succeed");
      if (result.success) {
        const schema = z.object({ result: z.string() });
        const parsed = schema.safeParse(JSON.parse(result.value.content));
        assert.ok(
          parsed.success,
          "Response should validate against Zod schema",
        );
        if (parsed.success) {
          assert.strictEqual(parsed.data.result, "validated output");
        }
      }
      console.log("✅ Test 6: Zod schema validation of response - passed");
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
    }
  }

  // --- Test 7: Provider metadata in response ---
  {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";

    try {
      const fetchMock = makeFetchMock([{ body: validResponseBody }]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const result = await adapter.sendRequest(makeRequest());

      assert.ok(result.success, "Should succeed");
      if (result.success) {
        assert.ok(result.value.metadata, "Should include metadata");
        assert.strictEqual(
          (result.value.metadata as Record<string, unknown>).provider,
          "openai",
          "Metadata should contain provider id",
        );
        assert.strictEqual(
          (result.value.metadata as Record<string, unknown>).model,
          "gpt-4o-mini",
          "Metadata should contain model name",
        );
      }
      console.log("✅ Test 7: provider metadata in response - passed");
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
    }
  }

  console.log("✅ All CloudLLMPipelineAdapter tests passed.");
})();
