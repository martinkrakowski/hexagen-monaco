import { describe, it } from "node:test";
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
});
