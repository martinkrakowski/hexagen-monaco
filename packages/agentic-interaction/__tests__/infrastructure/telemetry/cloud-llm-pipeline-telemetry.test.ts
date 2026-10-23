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
    delete process.env.TEST_MISTRAL_API_KEY;
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

  it("marks the span ERROR with the error class name when every provider fails", async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls++;
      return {
        ok: false,
        status: 500,
        text: async () => "upstream exploded",
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;

    process.env.TEST_MISTRAL_API_KEY = "sk-test-key-mistral";
    const failingChain: ProviderFallbackChain = {
      primary: testChain.primary,
      fallbacks: [
        {
          providerId: "mistral",
          baseUrl: "https://api.mistral.ai/v1",
          model: "mistral-large-latest",
          apiKeyEnvVar: "TEST_MISTRAL_API_KEY",
          temperature: 0.4,
          maxTokens: 4096,
          timeoutMs: 60000,
        },
      ],
    };

    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: failingChain,
      secretVault: envVault(),
      fetchFn: fetchMock,
    };

    const result: Result<unknown> = await new CloudLLMPipelineAdapter(
      config,
    ).sendRequest(makeRequest());
    expect(result.success).toBe(false);
    expect(calls).toBe(2);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("llm.chat");
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

  it("attributes the span to the fallback provider that answered", async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false,
          status: 500,
          text: async () => "primary exploded",
          json: async () => ({}),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...validResponseBody,
          // The provider echoes the model it actually served — an alias,
          // not the requested name.
          model: "mistral-large-20261001",
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }),
        text: async () => "{}",
      } as Response;
    }) as unknown as typeof fetch;

    process.env.TEST_MISTRAL_API_KEY = "sk-test-key-mistral";
    const fallbackChain: ProviderFallbackChain = {
      primary: testChain.primary,
      fallbacks: [
        {
          providerId: "mistral",
          baseUrl: "https://api.mistral.ai/v1",
          model: "mistral-large-latest",
          apiKeyEnvVar: "TEST_MISTRAL_API_KEY",
          temperature: 0.4,
          maxTokens: 4096,
          timeoutMs: 60000,
        },
      ],
    };

    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain,
      secretVault: envVault(),
      fetchFn: fetchMock,
    };

    const result: Result<unknown> = await new CloudLLMPipelineAdapter(
      config,
    ).sendRequest(makeRequest());
    expect(result.success).toBe(true);
    expect(calls).toBe(2);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    // The span names the provider and model that actually answered; the
    // primary stays recorded only as llm.provider.primary.
    expect(span.attributes["llm.provider"]).toBe("mistral");
    expect(span.attributes["llm.system"]).toBe("mistral");
    expect(span.attributes["llm.model_name"]).toBe("mistral-large-20261001");
    expect(span.attributes["gen_ai.system"]).toBe("mistral");
    expect(span.attributes["gen_ai.request.model"]).toBe(
      "mistral-large-20261001",
    );
    expect(span.attributes["llm.provider.primary"]).toBe("openai");
    expect(span.status.code).toBe(SpanStatusCode.OK);
    // Usage comes from the fallback's response.
    expect(span.attributes["llm.token_count.total"]).toBe(12);
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(8);
    // No attribute carries the failed primary's response body.
    for (const [, value] of Object.entries(span.attributes)) {
      expect(String(value)).not.toContain("primary exploded");
    }
  });
});
