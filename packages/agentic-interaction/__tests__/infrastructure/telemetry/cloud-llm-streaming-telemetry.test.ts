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
    delete process.env.TEST_STREAM_FALLBACK_API_KEY;
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

  it("marks the span ERROR (class name only) when the stream fails after partial output", async () => {
    const fetchMock = (async () => {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(sseChunk("chunk1")));
            // Fail the stream mid-read, but only after the queued chunk is
            // deliverable — error() discards unread queued chunks.
            setTimeout(
              () => controller.error(new TypeError("socket hang up")),
              0,
            );
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
    const outcomes: boolean[] = [];
    for await (const r of streamStructuredRequest(
      config,
      fetchMock,
      makeRequest(),
    )) {
      outcomes.push(r.success);
      if (r.success) chunks.push(r.value);
    }
    // The streaming behaviour is unchanged: the partial output is the
    // whole result and the failure itself is never yielded.
    expect(outcomes).toEqual([true]);
    expect(chunks).toEqual(["chunk1"]);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("llm.chat.stream");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    // The error's class name only — never its message body.
    expect(span.status.message).toBe("TypeError");
    // No attribute or status carries the request's message text or the
    // provider's response body.
    for (const [, value] of Object.entries(span.attributes)) {
      const text = String(value);
      expect(text).not.toContain("stream content");
      expect(text).not.toContain("socket hang up");
    }
    expect(String(span.status.message)).not.toContain("socket hang up");
  });

  it("attributes the span to the fallback provider that streamed the output", async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 500,
          text: async () => "primary exploded",
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
                'data: {"model":"mistral-large-20261001","choices":[{"delta":{"content":"fb1"}}]}\n',
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n"));
            controller.close();
          },
        }),
      } as Response;
    }) as unknown as typeof fetch;

    process.env.TEST_STREAM_FALLBACK_API_KEY = "sk-test-fallback";
    const chainWithFallback: ProviderFallbackChain = {
      primary: testChain.primary,
      fallbacks: [
        {
          providerId: "mistral",
          baseUrl: "https://api.mistral.ai/v1",
          model: "mistral-large-latest",
          apiKeyEnvVar: "TEST_STREAM_FALLBACK_API_KEY",
          temperature: 0.4,
          maxTokens: 4096,
          timeoutMs: 60000,
        },
      ],
    };

    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: chainWithFallback,
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
    expect(calls).toBe(2);
    expect(chunks).toEqual(["fb1"]);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    // The span names the provider and model that actually answered — the
    // provider-echoed model, not the requested one — and keeps the
    // primary only as llm.provider.primary.
    expect(span.attributes["llm.provider"]).toBe("mistral");
    expect(span.attributes["llm.system"]).toBe("mistral");
    expect(span.attributes["llm.model_name"]).toBe("mistral-large-20261001");
    expect(span.attributes["gen_ai.system"]).toBe("mistral");
    expect(span.attributes["gen_ai.request.model"]).toBe(
      "mistral-large-20261001",
    );
    expect(span.attributes["llm.provider.primary"]).toBe("openai");
    expect(span.status.code).toBe(SpanStatusCode.OK);
    // No attribute carries the streamed content or the failed primary's
    // response body.
    for (const [, value] of Object.entries(span.attributes)) {
      const text = String(value);
      expect(text).not.toContain("fb1");
      expect(text).not.toContain("primary exploded");
    }
  });
});
