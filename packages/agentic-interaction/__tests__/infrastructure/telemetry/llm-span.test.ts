import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { err, ok } from "@hexagen/shared";
import {
  recordLlmUsage,
  withLlmSpan,
} from "../../../src/infrastructure/telemetry/llm-span";

function setupTelemetry(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  return exporter;
}

describe("llm-span helper", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = setupTelemetry();
  });

  afterEach(() => {
    trace.disable();
  });

  it("sets the LLM span kind and the caller's attributes", async () => {
    await withLlmSpan(
      "llm.chat",
      {
        "llm.provider": "openai",
        "llm.system": "openai",
        "llm.model_name": "gpt-4o-mini",
        "gen_ai.system": "openai",
        "gen_ai.request.model": "gpt-4o-mini",
        "gen_ai.operation.name": "chat",
      },
      async () => {},
    );

    const [span] = exporter.getFinishedSpans();
    expect(span).toBeDefined();
    expect(span.name).toBe("llm.chat");
    expect(span.attributes["openinference.span.kind"]).toBe("LLM");
    expect(span.attributes["llm.provider"]).toBe("openai");
    expect(span.attributes["llm.system"]).toBe("openai");
    expect(span.attributes["llm.model_name"]).toBe("gpt-4o-mini");
    expect(span.attributes["gen_ai.system"]).toBe("openai");
    expect(span.attributes["gen_ai.request.model"]).toBe("gpt-4o-mini");
    expect(span.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("supports synchronous callbacks", async () => {
    const result = await withLlmSpan("llm.chat", {}, () => 42);
    expect(result).toBe(42);
    const [span] = exporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("ends the span with ERROR (class name only) when fn throws and rethrows", async () => {
    await expect(
      withLlmSpan("llm.chat", {}, () => {
        throw new RangeError("tokens exceeded");
      }),
    ).rejects.toThrow(RangeError);

    const [span] = exporter.getFinishedSpans();
    expect(span).toBeDefined();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("RangeError");
    expect(span.endTime).toBeDefined();
    // The provider body must never leak into the span.
    expect(span.status.message).not.toContain("tokens exceeded");
  });

  it("marks the span ERROR (class name only) when failed() reports a returned failure", async () => {
    await withLlmSpan(
      "llm.chat",
      {},
      async () => err(new RangeError("quota exhausted")),
      (result) =>
        result.success
          ? undefined
          : result.error instanceof Error
            ? result.error
            : { name: "Error" },
    );

    const [span] = exporter.getFinishedSpans();
    expect(span).toBeDefined();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("RangeError");
    // The message body must never leak into the span status.
    expect(span.status.message).not.toContain("quota exhausted");
  });

  it("stays OK when failed() is given but reports the value as a success", async () => {
    await withLlmSpan(
      "llm.chat",
      {},
      async () => ok("fine"),
      (result) =>
        result.success
          ? undefined
          : result.error instanceof Error
            ? result.error
            : { name: "Error" },
    );

    const [span] = exporter.getFinishedSpans();
    expect(span).toBeDefined();
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("leaves a resolved failure value OK when no failed callback is given", async () => {
    // Unchanged behaviour: without the callback the helper cannot know a
    // resolved value is a failure, so the span stays OK.
    await withLlmSpan("llm.chat", {}, async () =>
      err(new RangeError("quota exhausted")),
    );

    const [span] = exporter.getFinishedSpans();
    expect(span).toBeDefined();
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("records token counts when present and skips missing fields", async () => {
    await withLlmSpan("llm.chat", {}, (span) => {
      recordLlmUsage(span, {
        prompt_tokens: 10,
        total_tokens: 15,
      });
    });

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes["llm.token_count.prompt"]).toBe(10);
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(10);
    expect(span.attributes["llm.token_count.completion"]).toBeUndefined();
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBeUndefined();
    expect(span.attributes["llm.token_count.total"]).toBe(15);
  });

  it("records nothing when usage is absent", async () => {
    await withLlmSpan("llm.chat", {}, (span) => {
      recordLlmUsage(span, {});
    });

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes["llm.token_count.prompt"]).toBeUndefined();
    expect(span.attributes["llm.token_count.completion"]).toBeUndefined();
    expect(span.attributes["llm.token_count.total"]).toBeUndefined();
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBeUndefined();
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBeUndefined();
  });
});
