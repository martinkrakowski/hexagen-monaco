import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { EventBusPort, DomainEvent } from "@hexagen/messaging";
import { Stage3CloudDispatchUseCase } from "../../src/application/use-cases/stage3-cloud-dispatch.use-case.js";
import { TANDEM_EVENT_TYPES } from "../../src/domain/index.js";

// ---------------------------------------------------------------------------
// EventBus fake
// ---------------------------------------------------------------------------

class EventBusFake implements EventBusPort {
  published: DomainEvent<unknown>[] = [];

  publish<T = unknown>(event: DomainEvent<T>): void {
    this.published.push(event as DomainEvent<unknown>);
  }

  subscribe(): () => void {
    return () => {};
  }

  unsubscribe(): void {}

  clear(): void {
    this.published = [];
  }
}

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

type FetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const originalFetch = globalThis.fetch;

function installFetchMock(mock: FetchMock): void {
  (globalThis as Record<string, unknown>).fetch = mock;
}

function restoreFetch(): void {
  (globalThis as Record<string, unknown>).fetch = originalFetch;
}

function buildSSEResponse(
  chunks: string[],
  headers: Record<string, string> = {},
): Response {
  const sseLines =
    chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n";
  const encoder = new TextEncoder();
  const encoded = encoder.encode(sseLines);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      ...headers,
    },
  });
}

function buildErrorResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Stage3CloudDispatchUseCase — successful SSE stream", () => {
  let eventBus: EventBusFake;
  let useCase: Stage3CloudDispatchUseCase;

  beforeEach(() => {
    eventBus = new EventBusFake();
    useCase = new Stage3CloudDispatchUseCase(eventBus);
  });

  afterEach(restoreFetch);

  it("returns full content with partial: false on successful stream", async () => {
    installFetchMock(async () => buildSSEResponse(["Hello", " world", "!"]));

    const result = await useCase.execute({
      payload: "Test payload",
      conversationId: "conv-1",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    assert.strictEqual(result.partial, false);
    assert.strictEqual(result.content, "Hello world!");
    assert.strictEqual(result.errorType, undefined);
  });

  it("calls onToken for each chunk", async () => {
    installFetchMock(async () =>
      buildSSEResponse(["chunk1", "chunk2", "chunk3"]),
    );

    const tokens: string[] = [];
    await useCase.execute({
      payload: "Test",
      conversationId: "conv-2",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
      onToken: (chunk) => tokens.push(chunk),
    });

    assert.deepStrictEqual(tokens, ["chunk1", "chunk2", "chunk3"]);
  });

  it("emits CLOUD_HANDOFF_STARTED and CLOUD_HANDOFF_COMPLETED events", async () => {
    installFetchMock(async () => buildSSEResponse(["response"]));

    await useCase.execute({
      payload: "Test",
      conversationId: "conv-3",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    const types = eventBus.published.map((e) => e.type);
    assert.ok(types.includes(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_STARTED));
    assert.ok(types.includes(TANDEM_EVENT_TYPES.CLOUD_HANDOFF_COMPLETED));
  });
});

describe("Stage3CloudDispatchUseCase — 429 rate limited", () => {
  let eventBus: EventBusFake;
  let useCase: Stage3CloudDispatchUseCase;

  beforeEach(() => {
    eventBus = new EventBusFake();
    useCase = new Stage3CloudDispatchUseCase(eventBus);
  });

  afterEach(restoreFetch);

  it("returns errorType: rate_limited when autoRetryEnabled is false", async () => {
    installFetchMock(async () => buildErrorResponse(429));

    const result = await useCase.execute({
      payload: "Test",
      conversationId: "conv-4",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    assert.strictEqual(result.errorType, "rate_limited");
    assert.strictEqual(result.partial, false);
  });

  it("parses Retry-After header when present", async () => {
    installFetchMock(async () =>
      buildErrorResponse(429, { "Retry-After": "30" }),
    );

    const result = await useCase.execute({
      payload: "Test",
      conversationId: "conv-5",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    assert.strictEqual(result.errorType, "rate_limited");
    assert.strictEqual(result.retryAfterSeconds, 30);
  });

  it("emits CLOUD_HANDOFF_FAILED event on rate limit", async () => {
    installFetchMock(async () => buildErrorResponse(429));

    await useCase.execute({
      payload: "Test",
      conversationId: "conv-6",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    const failedEvents = eventBus.published.filter(
      (e) => e.type === TANDEM_EVENT_TYPES.CLOUD_HANDOFF_FAILED,
    );
    assert.ok(failedEvents.length > 0);
  });
});

describe("Stage3CloudDispatchUseCase — network failure", () => {
  let eventBus: EventBusFake;
  let useCase: Stage3CloudDispatchUseCase;

  beforeEach(() => {
    eventBus = new EventBusFake();
    useCase = new Stage3CloudDispatchUseCase(eventBus);
  });

  afterEach(restoreFetch);

  it("returns errorType: network_failure on fetch throw", async () => {
    installFetchMock(async () => {
      throw new Error("Network error");
    });

    const result = await useCase.execute({
      payload: "Test",
      conversationId: "conv-7",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    assert.strictEqual(result.errorType, "network_failure");
    assert.strictEqual(result.partial, true);
  });

  it("emits CLOUD_HANDOFF_FAILED event on network error", async () => {
    installFetchMock(async () => {
      throw new Error("Connection refused");
    });

    await useCase.execute({
      payload: "Test",
      conversationId: "conv-8",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    const failedEvents = eventBus.published.filter(
      (e) => e.type === TANDEM_EVENT_TYPES.CLOUD_HANDOFF_FAILED,
    );
    assert.ok(failedEvents.length > 0);
  });
});

describe("Stage3CloudDispatchUseCase — AbortError / cancellation", () => {
  let eventBus: EventBusFake;
  let useCase: Stage3CloudDispatchUseCase;

  beforeEach(() => {
    eventBus = new EventBusFake();
    useCase = new Stage3CloudDispatchUseCase(eventBus);
  });

  afterEach(restoreFetch);

  it("returns errorType: cancelled when fetch throws AbortError", async () => {
    installFetchMock(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    });

    const result = await useCase.execute({
      payload: "Test",
      conversationId: "conv-9",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    assert.strictEqual(result.errorType, "cancelled");
    assert.strictEqual(result.partial, true);
  });
});

describe("Stage3CloudDispatchUseCase — BYOK ciphertext rotation", () => {
  let eventBus: EventBusFake;
  let useCase: Stage3CloudDispatchUseCase;

  beforeEach(() => {
    eventBus = new EventBusFake();
    useCase = new Stage3CloudDispatchUseCase(eventBus);
  });

  afterEach(restoreFetch);

  it("emits BYOK_CIPHERTEXT_ROTATED event when X-Byok-Rotated-Ciphertext header is present", async () => {
    const newCiphertext = "new-encrypted-ciphertext-value";
    installFetchMock(async () =>
      buildSSEResponse(["response"], {
        "X-Byok-Rotated-Ciphertext": newCiphertext,
      }),
    );

    await useCase.execute({
      payload: "Test",
      conversationId: "conv-10",
      refinementEngine: "BYOK",
      byokCiphertext: "old-ciphertext",
      byokProvider: "openai",
      autoRetryEnabled: false,
    });

    const rotationEvents = eventBus.published.filter(
      (e) => e.type === TANDEM_EVENT_TYPES.BYOK_CIPHERTEXT_ROTATED,
    );
    assert.strictEqual(rotationEvents.length, 1);

    const payload = rotationEvents[0]?.payload as {
      conversationId: string;
      newCiphertext: string;
    };
    assert.strictEqual(payload.newCiphertext, newCiphertext);
    assert.strictEqual(payload.conversationId, "conv-10");
  });

  it("does NOT emit BYOK_CIPHERTEXT_ROTATED when header is absent", async () => {
    installFetchMock(async () => buildSSEResponse(["response"]));

    await useCase.execute({
      payload: "Test",
      conversationId: "conv-11",
      refinementEngine: "ENV",
      autoRetryEnabled: false,
    });

    const rotationEvents = eventBus.published.filter(
      (e) => e.type === TANDEM_EVENT_TYPES.BYOK_CIPHERTEXT_ROTATED,
    );
    assert.strictEqual(rotationEvents.length, 0);
  });
});
