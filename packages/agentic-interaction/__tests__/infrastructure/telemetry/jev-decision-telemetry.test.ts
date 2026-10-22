import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { JevDecisionAdapter } from "../../../src/infrastructure/adapters/jev-decision.adapter";
import type {
  DecisionAdviceRequest,
  DecisionAdviceResult,
} from "../../../src/domain/decision-advice";
import type { SecretVaultPort } from "../../../src/domain/provider-config";

function setupTelemetry(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  return exporter;
}

const KEY = "sk-or-v1-jev-test-key-DO-NOT-LEAK";

function vault(key: string | null): SecretVaultPort {
  return { getSecret: (_name: string) => key };
}

/** A fake fetch serving a canned JSON response. */
function fetchServing(
  body: unknown,
  response: { status?: number } = {},
): typeof globalThis.fetch {
  return ((_url: unknown, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: response.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof globalThis.fetch;
}

function adapterWith(
  fetchImpl: typeof globalThis.fetch,
  key: string | null = KEY,
): JevDecisionAdapter {
  return new JevDecisionAdapter({
    secretVault: vault(key),
    fetch: fetchImpl,
    timeoutMs: 3000,
  });
}

const request: DecisionAdviceRequest = {
  use: "context-type",
  fields: [{ name: "project", value: "bike-rental" }],
  questions: {
    q0: {
      type: "choice",
      instructions: "Classify bounded context q0 as one DDD context type.",
      criteria: {
        core: "Central business capability, primary revenue driver",
        supporting: "Augments a core context",
      },
    },
  },
};

const advisedBody = {
  answers: {
    q0: {
      type: "choice",
      choice: "core",
      probabilities: { core: 1, supporting: 0 },
      confidence: 1,
    },
  },
  model: "typesafe/jev-1.14",
  usage: { cost: 0.00001 },
};

/** Nothing but the closed-set metadata may appear on the span. */
function expectOnlyClosedSetValues(
  span: { attributes: Record<string, unknown>; status: { message?: string } },
): void {
  for (const [, value] of Object.entries(span.attributes)) {
    const text = String(value);
    expect(text).not.toContain(request.questions["q0"].instructions);
    expect(text).not.toContain("Central business capability");
    expect(text).not.toContain("bike-rental");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("upstream exploded");
  }
  expect(String(span.status.message)).not.toContain(KEY);
  expect(String(span.status.message)).not.toContain("upstream exploded");
}

describe("JevDecisionAdapter telemetry", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = setupTelemetry();
  });

  afterEach(() => {
    trace.disable();
    vi.useRealTimers();
  });

  it("keeps an advised call OK", async () => {
    const result: DecisionAdviceResult = await adapterWith(
      fetchServing(advisedBody),
    ).ask(request);
    expect(result.status).toBe("advised");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("jev.decision");
    expect(span.attributes["gen_ai.operation.name"]).toBe("decision");
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expectOnlyClosedSetValues(span);
  });

  it("keeps unknown without a receipt (disabled) OK — no call was made", async () => {
    const result = await adapterWith(fetchServing(advisedBody), null).ask(
      request,
    );
    expect(result).toEqual({ status: "unknown", reason: "disabled" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    expectOnlyClosedSetValues(spans[0]);
  });

  it("marks the span ERROR with the JevHttp token on an HTTP 500 receipt", async () => {
    const result = await adapterWith(
      fetchServing({ error: "upstream exploded" }, { status: 500 }),
    ).ask(request);
    expect(result).toMatchObject({ status: "unknown", reason: "http" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    // The fixed token only — no other text rides along.
    expect(span.status.message).toBe("JevHttp");
    expectOnlyClosedSetValues(span);
  });

  it("marks the span ERROR with the JevTimeout token on a timeout receipt", async () => {
    vi.useFakeTimers();
    const never = ((_url: unknown, _init?: RequestInit) =>
      new Promise<Response>(() => undefined)) as typeof globalThis.fetch;
    const promise = adapterWith(never).ask(request);

    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;
    expect(result).toMatchObject({ status: "unknown", reason: "timeout" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("JevTimeout");
    expectOnlyClosedSetValues(span);
  });

  it("marks the span ERROR with the JevShape token on a body-past-the-cap receipt", async () => {
    const huge = { answers: { q0: { padding: "x".repeat(70 * 1024) } } };
    const result = await adapterWith(fetchServing(huge)).ask(request);
    expect(result).toMatchObject({ status: "unknown", reason: "shape" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("JevShape");
    expectOnlyClosedSetValues(span);
  });

  it("marks the span ERROR with the JevTie token on a tie receipt", async () => {
    const tie = {
      answers: {
        q0: {
          type: "choice",
          choice: "core",
          probabilities: { core: 0.5, supporting: 0.5 },
          confidence: 0.5,
        },
      },
      model: "typesafe/jev-1.14",
    };
    const result = await adapterWith(fetchServing(tie)).ask(request);
    expect(result).toMatchObject({ status: "unknown", reason: "tie" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("JevTie");
    expectOnlyClosedSetValues(span);
  });
});
