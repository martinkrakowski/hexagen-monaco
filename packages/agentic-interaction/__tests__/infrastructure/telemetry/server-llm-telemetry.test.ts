import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ServerLLMAdapter } from "../../../src/infrastructure/adapters/server-llm.adapter";
import type { LLMCompletionRequest } from "../../../src/domain/ports/llm-provider.port";

function setupTelemetry(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  return exporter;
}

function sseChunk(content: string): string {
  return `data: {"choices":[{"delta":{"content":${JSON.stringify(
    content,
  )}}}]}\n`;
}

function makeRequest(): LLMCompletionRequest {
  return {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are an assistant." },
      { role: "user", content: "Test prompt" },
    ],
    temperature: 0.4,
    maxTokens: 128,
  };
}

function stubFetch(response: unknown): void {
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
}

describe("ServerLLMAdapter telemetry", () => {
  let exporter: InMemorySpanExporter;
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    exporter = setupTelemetry();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    trace.disable();
  });

  it("emits a llm.chat.stream span carrying openinference.span.kind = LLM", async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(sseChunk("hello")));
          controller.enqueue(encoder.encode("data: [DONE]\n"));
          controller.close();
        },
      }),
    });

    const adapter = new ServerLLMAdapter("sk-test", "https://api.openai.com/v1");
    const chunks: string[] = [];
    for await (const r of adapter.streamComplete(makeRequest())) {
      if (r.success) chunks.push(r.value);
    }
    expect(chunks).toEqual(["hello"]);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("llm.chat.stream");
    expect(span.attributes["openinference.span.kind"]).toBe("LLM");
    expect(span.attributes["llm.provider"]).toBe("api.openai.com");
    expect(span.attributes["llm.system"]).toBe("api.openai.com");
    expect(span.attributes["llm.model_name"]).toBe("gpt-4o-mini");
    expect(span.attributes["gen_ai.request.model"]).toBe("gpt-4o-mini");
    expect(span.attributes["gen_ai.operation.name"]).toBe("chat.stream");
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.endTime).toBeDefined();
  });

  it("marks the stream span ERROR (class name only) when the provider responds non-ok", async () => {
    stubFetch({
      ok: false,
      status: 500,
      text: async () => "upstream exploded",
    });

    const adapter = new ServerLLMAdapter("sk-test", "https://api.openai.com/v1");
    const outcomes: boolean[] = [];
    for await (const r of adapter.streamComplete(makeRequest())) {
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
      expect(text).not.toContain("You are an assistant.");
      expect(text).not.toContain("Test prompt");
      expect(text).not.toContain("upstream exploded");
    }
    expect(String(span.status.message)).not.toContain("You are an assistant.");
    expect(String(span.status.message)).not.toContain("Test prompt");
    expect(String(span.status.message)).not.toContain("upstream exploded");
  });

  it("marks the chat span ERROR (class name only) when complete returns an error Result", async () => {
    stubFetch({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    });

    const adapter = new ServerLLMAdapter("sk-test", "https://api.openai.com/v1");
    const result = await adapter.complete(makeRequest());
    expect(result.success).toBe(false);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("llm.chat");
    expect(span.attributes["openinference.span.kind"]).toBe("LLM");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    // The error's class name only — never its message body.
    expect(span.status.message).toBe("Error");
    for (const [, value] of Object.entries(span.attributes)) {
      const text = String(value);
      expect(text).not.toContain("You are an assistant.");
      expect(text).not.toContain("Test prompt");
      expect(text).not.toContain("invalid api key");
    }
    expect(String(span.status.message)).not.toContain("invalid api key");
  });
});
