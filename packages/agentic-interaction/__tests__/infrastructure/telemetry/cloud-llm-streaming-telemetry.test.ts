import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import { streamStructuredRequest } from "../../../src/infrastructure/adapters/cloud-llm-streaming";
import type { CloudLLMPipelineAdapterConfig } from "../../../src/infrastructure/adapters/cloud-llm-streaming";
import {
  chainWithMistralFallback,
  deleteEnvKeys,
  envVault,
  expectNoTextInSpan,
  failureResponse,
  fetchQueue,
  fetchReturning,
  onlySpan,
  openaiChain,
  setEnvKeys,
  setupTelemetry,
  sseChunk,
  sseResponse,
  teardownTelemetry,
} from "./helpers";

const testChain = openaiChain("TEST_STREAM_API_KEY");
const ENV_KEYS = ["TEST_STREAM_API_KEY", "TEST_STREAM_FALLBACK_API_KEY"];

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

function makeConfig(fetchFn: typeof fetch): CloudLLMPipelineAdapterConfig {
  return { fallbackChain: testChain, secretVault: envVault(), fetchFn };
}

/** Runs one stream, collecting the per-chunk outcomes and content. */
async function collect(
  fetchMock: typeof fetch,
): Promise<{ outcomes: boolean[]; chunks: string[] }> {
  const outcomes: boolean[] = [];
  const chunks: string[] = [];
  for await (const r of streamStructuredRequest(
    makeConfig(fetchMock),
    fetchMock,
    makeRequest(),
  )) {
    outcomes.push(r.success);
    if (r.success) chunks.push(r.value);
  }
  return { outcomes, chunks };
}

describe("cloud-llm-streaming telemetry", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = setupTelemetry();
    setEnvKeys({ TEST_STREAM_API_KEY: "sk-test" });
  });

  afterEach(() => {
    deleteEnvKeys(ENV_KEYS);
    teardownTelemetry();
  });

  it("ends its llm.chat.stream span after the stream completes and records usage chunks", async () => {
    const fetchMock = fetchReturning(
      sseResponse([
        sseChunk("chunk1"),
        sseChunk("chunk2"),
        'data: {"choices":[{"delta":{"content":""}}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n',
        "data: [DONE]\n",
      ]),
    );

    const { chunks } = await collect(fetchMock);
    expect(chunks).toEqual(["chunk1", "chunk2"]);

    const span = onlySpan(exporter);
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

  it.each([
    {
      title: "the stream yields a failure value",
      makeFetch: () =>
        fetchReturning(failureResponse(500, "upstream exploded")),
      outcomes: [false],
      chunks: [] as string[],
      message: "Error",
      forbidden: ["stream content", "upstream exploded"],
    },
    {
      title: "the stream fails after partial output",
      makeFetch: () =>
        fetchReturning(
          sseResponse([sseChunk("chunk1")], new TypeError("socket hang up")),
        ),
      outcomes: [true],
      chunks: ["chunk1"],
      message: "TypeError",
      forbidden: ["stream content", "socket hang up"],
    },
  ])(
    "marks the span ERROR (class name only) when $title",
    async ({ makeFetch, outcomes, chunks, message, forbidden }) => {
      const received = await collect(makeFetch());
      // The streaming behaviour is unchanged: on a post-partial failure
      // the partial output is the whole result and the failure itself is
      // never yielded.
      expect(received.outcomes).toEqual(outcomes);
      expect(received.chunks).toEqual(chunks);

      const span = onlySpan(exporter);
      expect(span.name).toBe("llm.chat.stream");
      expect(span.attributes["openinference.span.kind"]).toBe("LLM");
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      // The error's class name only — never its message body.
      expect(span.status.message).toBe(message);
      expectNoTextInSpan(span, forbidden);
    },
  );

  it("attributes the span to the fallback provider that streamed the output", async () => {
    const stub = fetchQueue([
      failureResponse(500, "primary exploded"),
      sseResponse([
        'data: {"model":"mistral-large-20261001","choices":[{"delta":{"content":"fb1"}}]}\n',
        "data: [DONE]\n",
      ]),
    ]);

    setEnvKeys({ TEST_STREAM_FALLBACK_API_KEY: "sk-test-fallback" });
    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: chainWithMistralFallback(
        "TEST_STREAM_API_KEY",
        "TEST_STREAM_FALLBACK_API_KEY",
      ),
      secretVault: envVault(),
      fetchFn: stub.fetch,
    };

    const chunks: string[] = [];
    for await (const r of streamStructuredRequest(
      config,
      stub.fetch,
      makeRequest(),
    )) {
      if (r.success) chunks.push(r.value);
    }
    expect(stub.calls()).toBe(2);
    expect(chunks).toEqual(["fb1"]);

    const span = onlySpan(exporter);
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
    expectNoTextInSpan(span, ["fb1", "primary exploded"]);
  });
});
