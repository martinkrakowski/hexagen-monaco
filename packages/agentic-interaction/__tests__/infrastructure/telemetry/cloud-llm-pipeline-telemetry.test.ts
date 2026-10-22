import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { Result } from "@hexagen/shared";
import { z } from "zod";
import { CloudLLMPipelineAdapter } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
import type { CloudLLMPipelineAdapterConfig } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
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
    apiKeyEnvVar: "TEST_OPENAI_API_KEY",
    temperature: 0.4,
    maxTokens: 4096,
    timeoutMs: 60000,
  },
  fallbacks: [],
};

function makeRequest() {
  return {
    id: "llm-req-test-1",
    modelId: "gpt-4o-mini" as never,
    messages: [
      { role: "system" as const, content: "You are an assistant." },
      { role: "user" as const, content: "Test prompt" },
    ],
    schema: z.object({ result: z.string() }),
    temperature: 0.4,
    maxTokens: 1024,
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

describe("CloudLLMPipelineAdapter telemetry", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = setupTelemetry();
    process.env.TEST_OPENAI_API_KEY = "sk-test-key-123";
  });

  afterEach(() => {
    delete process.env.TEST_OPENAI_API_KEY;
    trace.disable();
  });

  it("emits one llm.chat span with provider/model and token counts", async () => {
    const fetchMock = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => validResponseBody,
        text: async () => JSON.stringify(validResponseBody),
      } as Response;
    }) as unknown as typeof fetch;

    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: testChain,
      secretVault: envVault(),
      fetchFn: fetchMock,
    };

    const result: Result<unknown> = await new CloudLLMPipelineAdapter(
      config,
    ).sendRequest(makeRequest());
    expect(result.success).toBe(true);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("llm.chat");
    expect(span.attributes["openinference.span.kind"]).toBe("LLM");
    expect(span.attributes["llm.provider"]).toBe("openai");
    expect(span.attributes["llm.model_name"]).toBe("gpt-4o-mini");
    expect(span.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(span.attributes["llm.token_count.prompt"]).toBe(10);
    expect(span.attributes["llm.token_count.completion"]).toBe(5);
    expect(span.attributes["llm.token_count.total"]).toBe(15);
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(10);
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(5);
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("never records the request message text in span attributes", async () => {
    const fetchMock = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => validResponseBody,
        text: async () => JSON.stringify(validResponseBody),
      } as Response;
    }) as unknown as typeof fetch;

    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: testChain,
      secretVault: envVault(),
      fetchFn: fetchMock,
    };

    await new CloudLLMPipelineAdapter(config).sendRequest(makeRequest());

    const span = exporter.getFinishedSpans()[0];
    for (const [, value] of Object.entries(span.attributes)) {
      const text = String(value);
      expect(text).not.toContain("You are an assistant.");
      expect(text).not.toContain("Test prompt");
    }
  });
});
