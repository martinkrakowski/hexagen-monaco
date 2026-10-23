import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { ServerLLMAdapter } from "../../../src/infrastructure/adapters/server-llm.adapter";
import type { LLMCompletionRequest } from "../../../src/domain/ports/llm-provider.port";
import {
  expectNoTextInSpan,
  onlySpan,
  setupTelemetry,
  sseChunk,
  sseResponse,
  teardownTelemetry,
} from "./helpers";

const MESSAGE_TEXT = ["You are an assistant.", "Test prompt"];

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
    teardownTelemetry();
  });

  it("emits a llm.chat.stream span carrying openinference.span.kind = LLM", async () => {
    stubFetch(sseResponse([sseChunk("hello"), "data: [DONE]\n"]));

    const adapter = new ServerLLMAdapter(
      "sk-test",
      "https://api.openai.com/v1",
    );
    const chunks: string[] = [];
    for await (const r of adapter.streamComplete(makeRequest())) {
      if (r.success) chunks.push(r.value);
    }
    expect(chunks).toEqual(["hello"]);

    const span = onlySpan(exporter);
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

  it.each([
    {
      title: "stream",
      spanName: "llm.chat.stream",
      status: 500,
      body: "upstream exploded",
      stream: true,
    },
    {
      title: "chat",
      spanName: "llm.chat",
      status: 401,
      body: "invalid api key",
      stream: false,
    },
  ])(
    "marks the $title span ERROR (class name only) when the provider responds non-ok",
    async ({ spanName, status, body, stream }) => {
      stubFetch({ ok: false, status, text: async () => body });

      const adapter = new ServerLLMAdapter(
        "sk-test",
        "https://api.openai.com/v1",
      );
      if (stream) {
        const outcomes: boolean[] = [];
        for await (const r of adapter.streamComplete(makeRequest())) {
          outcomes.push(r.success);
        }
        expect(outcomes).toEqual([false]);
      } else {
        const result = await adapter.complete(makeRequest());
        expect(result.success).toBe(false);
      }

      const span = onlySpan(exporter);
      expect(span.name).toBe(spanName);
      expect(span.attributes["openinference.span.kind"]).toBe("LLM");
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      // The error's class name only — never its message body.
      expect(span.status.message).toBe("Error");
      // No attribute or status carries the request's message text or the
      // provider's response body.
      expectNoTextInSpan(span, [...MESSAGE_TEXT, body]);
    },
  );
});
