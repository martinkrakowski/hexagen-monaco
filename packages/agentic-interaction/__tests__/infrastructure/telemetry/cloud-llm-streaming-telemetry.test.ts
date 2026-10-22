import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import { streamStructuredRequest } from "../../../src/infrastructure/adapters/cloud-llm-streaming";
import type { CloudLLMPipelineAdapterConfig } from "../../../src/infrastructure/adapters/cloud-llm-streaming";
import type { ProviderFallbackChain } from "../../../src/domain/provider-config";

function setupTelemetry(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  return exporter;
}

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
    id: "llm-req-stream-telemetry",
    modelId: "gpt-4o-mini" as never,
    messages: [{ role: "user" as const, content: "stream content" }],
    schema: z.string(),
    temperature: 0.4,
    maxTokens: 1024,
  };
}

function sseChunk(content: string): string {
  return `data: {"choices":[{"delta":{"content":${JSON.stringify(
    content,
  )}}}]}\n`;
}

describe("cloud-llm-streaming telemetry", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = setupTelemetry();
    process.env.TEST_STREAM_API_KEY = "sk-test";
  });

  afterEach(() => {
    delete process.env.TEST_STREAM_API_KEY;
    trace.disable();
  });

  it("ends its llm.chat.stream span after the stream completes and records usage chunks", async () => {
    const fetchMock = (async () => {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(sseChunk("chunk1")));
            controller.enqueue(encoder.encode(sseChunk("chunk2")));
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":""}}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n',
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

    const chunks: string[] = [];
    for await (const r of streamStructuredRequest(
      config,
      fetchMock,
      makeRequest(),
    )) {
      if (r.success) chunks.push(r.value);
    }

    expect(chunks).toEqual(["chunk1", "chunk2"]);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("llm.chat.stream");
    expect(span.attributes["openinference.span.kind"]).toBe("LLM");
    expect(span.attributes["llm.provider"]).toBe("openai");
    expect(span.attributes["llm.model_name"]).toBe("gpt-4o-mini");
    expect(span.attributes["gen_ai.operation.name"]).toBe("chat.stream");
    expect(span.attributes["llm.token_count.prompt"]).toBe(7);
    expect(span.attributes["llm.token_count.completion"]).toBe(3);
    expect(span.attributes["llm.token_count.total"]).toBe(10);
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(7);
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(3);
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.endTime).toBeDefined();
  });

  it("marks the span ERROR (class name only) when the stream yields a failure value", async () => {
    const fetchMock = (async () => {
      return {
        ok: false,
        status: 500,
        text: async () => "upstream exploded",
      } as Response;
    }) as unknown as typeof fetch;

    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: testChain,
      secretVault: envVault(),
      fetchFn: fetchMock,
    };

    const outcomes: boolean[] = [];
    for await (const r of streamStructuredRequest(
      config,
      fetchMock,
      makeRequest(),
    )) {
      outcomes.push(r.success);
    }
    expect(outcomes).toEqual([false]);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("llm.chat.stream");
    expect(span.attributes["openinference.span.kind"]).toBe("LLM");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    // The error's class name only — never its message body.
    expect(span.status.message).toBe("Error");
    // No attribute or status carries the request's message text or the
    // provider's response body.
    for (const [, value] of Object.entries(span.attributes)) {
      const text = String(value);
      expect(text).not.toContain("stream content");
      expect(text).not.toContain("upstream exploded");
    }
    expect(String(span.status.message)).not.toContain("stream content");
    expect(String(span.status.message)).not.toContain("upstream exploded");
  });
});
