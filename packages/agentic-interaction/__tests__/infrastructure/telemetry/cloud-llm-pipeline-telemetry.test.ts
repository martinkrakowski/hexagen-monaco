import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import type { Result } from "@hexagen/shared";
import { z } from "zod";
import { CloudLLMPipelineAdapter } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
import type { CloudLLMPipelineAdapterConfig } from "../../../src/infrastructure/adapters/cloud-llm-pipeline.adapter";
import {
  chainWithMistralFallback,
  deleteEnvKeys,
  envVault,
  expectNoTextInSpan,
  failureResponse,
  fetchQueue,
  fetchReturning,
  jsonResponse,
  onlySpan,
  openaiChain,
  setEnvKeys,
  setupTelemetry,
  teardownTelemetry,
} from "./helpers";

const testChain = openaiChain("TEST_OPENAI_API_KEY");
const ENV_KEYS = ["TEST_OPENAI_API_KEY", "TEST_MISTRAL_API_KEY"];
const MESSAGE_TEXT = ["You are an assistant.", "Test prompt"];

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

function makeConfig(fetchFn: typeof fetch): CloudLLMPipelineAdapterConfig {
  return { fallbackChain: testChain, secretVault: envVault(), fetchFn };
}

describe("CloudLLMPipelineAdapter telemetry", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = setupTelemetry();
    setEnvKeys({ TEST_OPENAI_API_KEY: "sk-test-key-123" });
  });

  afterEach(() => {
    deleteEnvKeys(ENV_KEYS);
    teardownTelemetry();
  });

  it("emits one llm.chat span with provider/model and token counts", async () => {
    const config = makeConfig(fetchReturning(jsonResponse(validResponseBody)));

    const result: Result<unknown> = await new CloudLLMPipelineAdapter(
      config,
    ).sendRequest(makeRequest());
    expect(result.success).toBe(true);

    const span = onlySpan(exporter);
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
    const config = makeConfig(fetchReturning(jsonResponse(validResponseBody)));

    await new CloudLLMPipelineAdapter(config).sendRequest(makeRequest());

    const span = onlySpan(exporter);
    expectNoTextInSpan(span, MESSAGE_TEXT);
  });

  it("marks the span ERROR with the error class name when every provider fails", async () => {
    const stub = fetchQueue([failureResponse(500, "upstream exploded")]);
    setEnvKeys({ TEST_MISTRAL_API_KEY: "sk-test-key-mistral" });
    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: chainWithMistralFallback(
        "TEST_OPENAI_API_KEY",
        "TEST_MISTRAL_API_KEY",
      ),
      secretVault: envVault(),
      fetchFn: stub.fetch,
    };

    const result: Result<unknown> = await new CloudLLMPipelineAdapter(
      config,
    ).sendRequest(makeRequest());
    expect(result.success).toBe(false);
    expect(stub.calls()).toBe(2);

    const span = onlySpan(exporter);
    expect(span.name).toBe("llm.chat");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    // The error's class name only — never its message body.
    expect(span.status.message).toBe("Error");
    // No attribute or status carries the request's message text or the
    // provider's response body.
    expectNoTextInSpan(span, [...MESSAGE_TEXT, "upstream exploded"]);
  });

  it("attributes the span to the fallback provider that answered", async () => {
    const stub = fetchQueue([
      failureResponse(500, "primary exploded"),
      jsonResponse({
        ...validResponseBody,
        // The provider echoes the model it actually served — an alias,
        // not the requested name.
        model: "mistral-large-20261001",
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }),
    ]);
    setEnvKeys({ TEST_MISTRAL_API_KEY: "sk-test-key-mistral" });
    const config: CloudLLMPipelineAdapterConfig = {
      fallbackChain: chainWithMistralFallback(
        "TEST_OPENAI_API_KEY",
        "TEST_MISTRAL_API_KEY",
      ),
      secretVault: envVault(),
      fetchFn: stub.fetch,
    };

    const result: Result<unknown> = await new CloudLLMPipelineAdapter(
      config,
    ).sendRequest(makeRequest());
    expect(result.success).toBe(true);
    expect(stub.calls()).toBe(2);

    const span = onlySpan(exporter);
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
    expectNoTextInSpan(span, ["primary exploded"]);
  });
});
