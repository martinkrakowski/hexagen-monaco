import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CloudLLMPipelineAdapter } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
import type { CloudLLMPipelineAdapterConfig } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
import type { ProviderFallbackChain } from "../../../src/domain/provider-config";
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

function envVault(): { getSecret: (name: string) => string | null } {
  return { getSecret: (name: string) => process.env[name] ?? null };
}

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

describe.skip("cloud-llm-pipeline", () => {
  it("should succeed with valid response", async () => {
    const originalEnv = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-test-key-123";

    try {
      const fetchMock = makeFetchMock([{ body: validResponseBody }]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
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
    } finally {
      if (originalEnv !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalEnv;
      else delete process.env.TEST_OPENAI_API_KEY;
    }
  });

  it("should fail when no API keys configured", async () => {
    delete process.env.TEST_OPENAI_API_KEY;
    delete process.env.TEST_OPENAI_FALLBACK_API_KEY;

    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: testChain,
      secretVault: envVault(),
      fetchFn: fetchMock as typeof fetch,
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
  });

  it("should fallback to secondary provider on 429", async () => {
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
        secretVault: envVault(),
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
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
      if (originalFallback !== undefined)
        process.env.TEST_OPENAI_FALLBACK_API_KEY = originalFallback;
      else delete process.env.TEST_OPENAI_FALLBACK_API_KEY;
    }
  });

  it("should fail when all providers fail", async () => {
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
        secretVault: envVault(),
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const result = await adapter.sendRequest(makeRequest());

      assert.ok(!result.success, "Should fail when all providers fail");
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
      if (originalFallback !== undefined)
        process.env.TEST_OPENAI_FALLBACK_API_KEY = originalFallback;
      else delete process.env.TEST_OPENAI_FALLBACK_API_KEY;
    }
  });

  it("should return immediately on non-retryable error", async () => {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";

    try {
      const fetchMock = makeFetchMock([
        { status: 401, body: { error: { message: "Invalid API key" } } },
      ]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
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
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
    }
  });

  it("should validate response against Zod schema", async () => {
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
        secretVault: envVault(),
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
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
    }
  });

  it("should include provider metadata in response", async () => {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";

    try {
      const fetchMock = makeFetchMock([{ body: validResponseBody }]);
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
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
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
    }
  });

  it("should fallback on 429 for streamStructuredRequest", async () => {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    const originalFallback = process.env.TEST_OPENAI_FALLBACK_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";
    process.env.TEST_OPENAI_FALLBACK_API_KEY = "sk-fallback";

    try {
      let callCount = 0;
      const fetchMock = async (_url: string, _opts: RequestInit) => {
        void _url;
        void _opts;
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            text: async () => '{"error":{"message":"Rate limited"}}',
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"hello"}}]}\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n"));
              controller.close();
            },
          }),
        } as Response;
      };
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const results: Array<Result<string>> = [];
      for await (const result of adapter.streamStructuredRequest(
        makeRequest(),
      )) {
        results.push(result);
      }

      assert.ok(
        results.some((r) => r.success && r.value === "hello"),
        "Should succeed via fallback provider",
      );
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
      if (originalFallback !== undefined)
        process.env.TEST_OPENAI_FALLBACK_API_KEY = originalFallback;
      else delete process.env.TEST_OPENAI_FALLBACK_API_KEY;
    }
  });

  it("should not fallback on 403 for streamStructuredRequest", async () => {
    const originalPrimary = process.env.TEST_OPENAI_API_KEY;
    const originalFallback = process.env.TEST_OPENAI_FALLBACK_API_KEY;
    process.env.TEST_OPENAI_API_KEY = "sk-primary";
    process.env.TEST_OPENAI_FALLBACK_API_KEY = "sk-fallback";

    try {
      let callCount = 0;
      const fetchMock = async (_url: string, _opts: RequestInit) => {
        void _url;
        void _opts;
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 403,
            statusText: "Forbidden",
            text: async () => '{"error":{"message":"Invalid API key"}}',
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"should not reach"}}]}\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n"));
              controller.close();
            },
          }),
        } as Response;
      };
      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
        fetchFn: fetchMock as typeof fetch,
      };
      const adapter = new CloudLLMPipelineAdapter(config);
      const results: Array<Result<string>> = [];
      for await (const result of adapter.streamStructuredRequest(
        makeRequest(),
      )) {
        results.push(result);
      }

      assert.strictEqual(callCount, 1, "Should not call fallback provider");
      assert.ok(
        results.length === 1 && !results[0].success,
        "Should return error immediately without fallback",
      );
      if (results[0] && !results[0].success) {
        assert.ok(
          results[0].error.message.includes("403"),
          "Error should include 403 status",
        );
      }
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_OPENAI_API_KEY = originalPrimary;
      else delete process.env.TEST_OPENAI_API_KEY;
      if (originalFallback !== undefined)
        process.env.TEST_OPENAI_FALLBACK_API_KEY = originalFallback;
      else delete process.env.TEST_OPENAI_FALLBACK_API_KEY;
    }
  });
});
