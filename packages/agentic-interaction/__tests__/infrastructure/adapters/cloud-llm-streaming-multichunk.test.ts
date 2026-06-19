import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { streamStructuredRequest } from "../../../src/infrastructure/adapters/cloud-llm-streaming";
import type { CloudLLMPipelineAdapterConfig } from "../../../src/infrastructure/adapters/cloud-llm-streaming";
import type { ProviderFallbackChain } from "../../../src/domain/provider-config";
import type { Result } from "@hexagen/shared";
import { z } from "zod";

function envVault(): { getSecret: (name: string) => string | null } {
  return { getSecret: (name: string) => process.env[name] ?? null };
}

const testChain: ProviderFallbackChain = {
  primary: {
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnvVar: "TEST_STREAM_API_KEY",
    temperature: 0.4,
    maxTokens: 4096,
    timeoutMs: 60000,
  },
  fallbacks: [],
};

function makeRequest() {
  return {
    id: "llm-req-stream-test",
    modelId: "gpt-4o-mini" as never,
    messages: [{ role: "user" as const, content: "test" }],
    schema: z.string(),
    temperature: 0.4,
    maxTokens: 1024,
  };
}

function sseStreamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(
            `data: {"choices":[{"delta":{"content":${JSON.stringify(chunk)}}}]}\n`,
          ),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n"));
      controller.close();
    },
  });
}

describe("cloud-llm-streaming multi-chunk delivery", () => {
  it("yields ALL chunks from the stream, not just the first", async () => {
    const original = process.env.TEST_STREAM_API_KEY;
    process.env.TEST_STREAM_API_KEY = "sk-test";

    try {
      const fetchMock = (async () => {
        return {
          ok: true,
          status: 200,
          body: sseStreamFromChunks([
            "Hello ",
            "world! ",
            "This is ",
            "a multi-chunk ",
            "stream test.",
          ]),
        } as Response;
      }) as unknown as typeof fetch;

      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
        fetchFn: fetchMock,
      };

      const results: Array<Result<string>> = [];
      for await (const r of streamStructuredRequest(
        config,
        fetchMock,
        makeRequest(),
      )) {
        results.push(r);
      }

      const successful = results.filter((r) => r.success);
      assert.strictEqual(
        successful.length,
        5,
        `Expected 5 chunks, got ${successful.length}. This regression indicates the streaming loop returns after the first chunk.`,
      );

      const joined = successful.map((r) => (r.success ? r.value : "")).join("");
      assert.strictEqual(
        joined,
        "Hello world! This is a multi-chunk stream test.",
      );
    } finally {
      if (original !== undefined) process.env.TEST_STREAM_API_KEY = original;
      else delete process.env.TEST_STREAM_API_KEY;
    }
  });

  it("yields chunks then stops on retryable error mid-stream", async () => {
    const original = process.env.TEST_STREAM_API_KEY;
    process.env.TEST_STREAM_API_KEY = "sk-test";

    try {
      const fetchMock = (async () => {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"chunk1"}}]}\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"chunk2"}}]}\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n"));
              controller.close();
            },
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
        fetchFn: fetchMock,
      };

      const results: Array<Result<string>> = [];
      for await (const r of streamStructuredRequest(
        config,
        fetchMock,
        makeRequest(),
      )) {
        results.push(r);
      }

      assert.strictEqual(results.length, 2);
      assert.ok(results[0].success && results[0].value === "chunk1");
      assert.ok(results[1].success && results[1].value === "chunk2");
    } finally {
      if (original !== undefined) process.env.TEST_STREAM_API_KEY = original;
      else delete process.env.TEST_STREAM_API_KEY;
    }
  });

  it("reports the served model once via onModelResolved, preferring the SSE frame's model", async () => {
    const original = process.env.TEST_STREAM_API_KEY;
    process.env.TEST_STREAM_API_KEY = "sk-test";

    try {
      // Frames carry a "model" field (as OpenAI-compatible providers do) that
      // DIFFERS from the requested model — the served one must win.
      const fetchMock = (async () => {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  'data: {"model":"gpt-4o-mini-2024-07-18","choices":[{"delta":{"content":"chunk1"}}]}\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'data: {"model":"gpt-4o-mini-2024-07-18","choices":[{"delta":{"content":"chunk2"}}]}\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n"));
              controller.close();
            },
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
        fetchFn: fetchMock,
      };

      const resolved: Array<{ provider: string; model: string }> = [];
      const request = {
        ...makeRequest(),
        onModelResolved: (info: { provider: string; model: string }) =>
          resolved.push(info),
      };

      for await (const r of streamStructuredRequest(
        config,
        fetchMock,
        request,
      )) {
        assert.ok(r.success);
      }

      assert.deepStrictEqual(resolved, [
        { provider: "openai", model: "gpt-4o-mini-2024-07-18" },
      ]);
    } finally {
      if (original !== undefined) process.env.TEST_STREAM_API_KEY = original;
      else delete process.env.TEST_STREAM_API_KEY;
    }
  });

  it("attributes the model to the provider that actually served after a cross-provider fallback", async () => {
    const originalPrimary = process.env.TEST_STREAM_API_KEY;
    const originalFallback = process.env.TEST_STREAM_FALLBACK_KEY;
    process.env.TEST_STREAM_API_KEY = "sk-primary";
    process.env.TEST_STREAM_FALLBACK_KEY = "sk-fallback";

    try {
      const chainWithFallback: ProviderFallbackChain = {
        primary: testChain.primary,
        fallbacks: [
          {
            providerId: "backup",
            baseUrl: "https://backup.example.com/v1",
            model: "backup-model",
            apiKeyEnvVar: "TEST_STREAM_FALLBACK_KEY",
            temperature: 0.4,
            maxTokens: 4096,
            timeoutMs: 60000,
          },
        ],
      };

      // Primary 503s before streaming any content (retryable → chain falls
      // back); the backup provider streams with its own served-model echo.
      let call = 0;
      const fetchMock = (async () => {
        call++;
        if (call === 1) {
          return {
            ok: false,
            status: 503,
            text: async () => "upstream unavailable",
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
                  'data: {"model":"backup-model-v2","choices":[{"delta":{"content":"chunk1"}}]}\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n"));
              controller.close();
            },
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: chainWithFallback,
        secretVault: envVault(),
        fetchFn: fetchMock,
      };

      const resolved: Array<{ provider: string; model: string }> = [];
      const request = {
        ...makeRequest(),
        onModelResolved: (info: { provider: string; model: string }) =>
          resolved.push(info),
      };

      const chunks: string[] = [];
      for await (const r of streamStructuredRequest(
        config,
        fetchMock,
        request,
      )) {
        assert.ok(r.success);
        chunks.push(r.value);
      }

      assert.strictEqual(call, 2, "Both providers should have been attempted");
      assert.deepStrictEqual(chunks, ["chunk1"]);
      // The failed primary never parsed a frame, so it must not have fired
      // the callback — exactly one report, from the provider that served.
      assert.deepStrictEqual(resolved, [
        { provider: "backup", model: "backup-model-v2" },
      ]);
    } finally {
      if (originalPrimary !== undefined)
        process.env.TEST_STREAM_API_KEY = originalPrimary;
      else delete process.env.TEST_STREAM_API_KEY;
      if (originalFallback !== undefined)
        process.env.TEST_STREAM_FALLBACK_KEY = originalFallback;
      else delete process.env.TEST_STREAM_FALLBACK_KEY;
    }
  });

  it("delivers all chunks even when the onModelResolved callback throws", async () => {
    const original = process.env.TEST_STREAM_API_KEY;
    process.env.TEST_STREAM_API_KEY = "sk-test";

    try {
      const fetchMock = (async () => {
        return {
          ok: true,
          status: 200,
          body: sseStreamFromChunks(["chunk1", "chunk2"]),
        } as Response;
      }) as unknown as typeof fetch;

      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
        fetchFn: fetchMock,
      };

      const request = {
        ...makeRequest(),
        onModelResolved: () => {
          throw new Error("observability callback exploded");
        },
      };

      // Unisolated, the throw is swallowed by the frame-level JSON catch and
      // silently drops the FIRST frame's content.
      const chunks: string[] = [];
      for await (const r of streamStructuredRequest(
        config,
        fetchMock,
        request,
      )) {
        assert.ok(r.success);
        chunks.push(r.value);
      }

      assert.deepStrictEqual(chunks, ["chunk1", "chunk2"]);
    } finally {
      if (original !== undefined) process.env.TEST_STREAM_API_KEY = original;
      else delete process.env.TEST_STREAM_API_KEY;
    }
  });

  it("falls back to the requested model when SSE frames omit one", async () => {
    const original = process.env.TEST_STREAM_API_KEY;
    process.env.TEST_STREAM_API_KEY = "sk-test";

    try {
      const fetchMock = (async () => {
        return {
          ok: true,
          status: 200,
          body: sseStreamFromChunks(["chunk1", "chunk2"]),
        } as Response;
      }) as unknown as typeof fetch;

      const config: CloudLLMPipelineAdapterConfig = {
        fallbackChain: testChain,
        secretVault: envVault(),
        fetchFn: fetchMock,
      };

      const resolved: Array<{ provider: string; model: string }> = [];
      const request = {
        ...makeRequest(),
        onModelResolved: (info: { provider: string; model: string }) =>
          resolved.push(info),
      };

      for await (const r of streamStructuredRequest(
        config,
        fetchMock,
        request,
      )) {
        assert.ok(r.success);
      }

      assert.deepStrictEqual(resolved, [
        { provider: "openai", model: "gpt-4o-mini" },
      ]);
    } finally {
      if (original !== undefined) process.env.TEST_STREAM_API_KEY = original;
      else delete process.env.TEST_STREAM_API_KEY;
    }
  });
});
