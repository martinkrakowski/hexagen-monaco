import { test } from "vitest";
import assert from "node:assert/strict";
import { ok, err, type Result } from "@hexagen/shared";
import { HandleServerChatUseCase } from "../../src/application/use-cases/HandleServerChatUseCase";
import type { LLMProviderPort } from "../../src/domain/ports/llm-provider.port";

interface Frame {
  type: string;
  content?: string;
  message?: string;
}

/**
 * A scripted LLM provider. `scripts[i]` is the sequence of `Result` chunks the
 * i-th `streamComplete` call yields, so a `[]` script models the provider's
 * empty-output mode (no chunks, no error). Extra calls reuse the last script.
 */
function fakeProvider(scripts: Array<Array<Result<string>>>) {
  let calls = 0;
  const provider: LLMProviderPort = {
    complete: async () => {
      throw new Error("complete() is not used by the streaming chat path");
    },
    async *streamComplete() {
      const script = scripts[Math.min(calls, scripts.length - 1)] ?? [];
      calls += 1;
      for (const chunk of script) yield chunk;
    },
  };
  return { provider, callCount: () => calls };
}

async function readFrames(
  stream: ReadableStream<Uint8Array>,
): Promise<Frame[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice(6)) as Frame);
}

const chunks = (frames: Frame[]) =>
  frames.filter((f) => f.type === "chunk").map((f) => f.content);

test("streams content on the first attempt without retrying", async () => {
  const { provider, callCount } = fakeProvider([[ok("Hello"), ok(" world")]]);
  const useCase = new HandleServerChatUseCase(provider, "test-model");

  const frames = await readFrames(
    await useCase.handleRequest({ messages: [] }, { id: "u1" }),
  );

  assert.deepEqual(chunks(frames), ["Hello", " world"]);
  assert.equal(frames.at(-1)?.type, "done");
  assert.ok(
    !frames.some((f) => f.type === "error"),
    "no error frame on a clean completion",
  );
  assert.equal(callCount(), 1, "a successful first attempt is not retried");
});

test("retries on an empty completion and streams the retry's content", async () => {
  // First attempt: empty (no chunks, no error) → the mercury empty-output mode.
  // Second attempt: real content.
  const { provider, callCount } = fakeProvider([[], [ok("recovered answer")]]);
  const useCase = new HandleServerChatUseCase(provider, "test-model");

  const frames = await readFrames(
    await useCase.handleRequest({ messages: [] }, { id: "u1" }),
  );

  assert.deepEqual(chunks(frames), ["recovered answer"]);
  assert.ok(
    !frames.some((f) => f.type === "error"),
    "a successful retry surfaces no error",
  );
  assert.equal(frames.at(-1)?.type, "done");
  assert.equal(callCount(), 2, "the empty first attempt was retried once");
});

test("surfaces an explicit error after every attempt returns empty", async () => {
  const { provider, callCount } = fakeProvider([[], [], []]);
  const useCase = new HandleServerChatUseCase(provider, "test-model", 3);

  const frames = await readFrames(
    await useCase.handleRequest({ messages: [] }, { id: "u1" }),
  );

  assert.equal(chunks(frames).length, 0, "no content was streamed");
  const error = frames.find((f) => f.type === "error");
  assert.ok(
    error,
    "an error frame is emitted instead of a silent empty stream",
  );
  assert.match(error!.message!, /empty response after 3 attempts/i);
  assert.equal(frames.at(-1)?.type, "done");
  assert.equal(callCount(), 3, "all configured attempts were used");
});

test("does not retry a hard provider error (surfaces it immediately)", async () => {
  const { provider, callCount } = fakeProvider([
    [err(new Error("LLM API error: 401 invalid key"))],
    [ok("should never be reached")],
  ]);
  const useCase = new HandleServerChatUseCase(provider, "test-model", 3);

  const frames = await readFrames(
    await useCase.handleRequest({ messages: [] }, { id: "u1" }),
  );

  assert.equal(chunks(frames).length, 0);
  const error = frames.find((f) => f.type === "error");
  assert.match(error!.message!, /401 invalid key/);
  assert.equal(frames.at(-1)?.type, "done");
  assert.equal(callCount(), 1, "a hard error is not retried");
});

test("commits to an attempt once content streams, surfacing a trailing error", async () => {
  // Content then a mid-stream error: we must not retry (the chunk already
  // reached the client) and must still surface the error before done.
  const { provider, callCount } = fakeProvider([
    [ok("partial "), err(new Error("connection reset"))],
    [ok("unreached")],
  ]);
  const useCase = new HandleServerChatUseCase(provider, "test-model", 3);

  const frames = await readFrames(
    await useCase.handleRequest({ messages: [] }, { id: "u1" }),
  );

  assert.deepEqual(chunks(frames), ["partial "]);
  const error = frames.find((f) => f.type === "error");
  assert.match(error!.message!, /connection reset/);
  assert.equal(frames.at(-1)?.type, "done");
  assert.equal(callCount(), 1, "a streamed attempt is never retried");
});

test("emits error then done when the provider throws", async () => {
  // A provider whose stream throws on iteration (vs. yielding an err Result):
  // the use-case's outer catch must still emit error + done.
  const provider: LLMProviderPort = {
    complete: async () => {
      throw new Error("complete() is not used by the streaming chat path");
    },
    streamComplete: () => {
      throw new Error("network exploded");
    },
  };
  const useCase = new HandleServerChatUseCase(provider, "test-model");

  const frames = await readFrames(
    await useCase.handleRequest({ messages: [] }, { id: "u1" }),
  );

  const error = frames.find((f) => f.type === "error");
  assert.match(error!.message!, /network exploded/);
  assert.equal(
    frames.at(-1)?.type,
    "done",
    "a thrown exception still terminates the stream with done",
  );
});

test("coerces a non-finite maxAttempts to the default instead of disabling retries", async () => {
  // NaN must not silently disable every attempt (Math.max(1, NaN) === NaN).
  const { provider, callCount } = fakeProvider([[], [ok("recovered")]]);
  const useCase = new HandleServerChatUseCase(
    provider,
    "test-model",
    Number.NaN,
  );

  const frames = await readFrames(
    await useCase.handleRequest({ messages: [] }, { id: "u1" }),
  );

  assert.deepEqual(chunks(frames), ["recovered"]);
  assert.equal(
    callCount(),
    2,
    "NaN falls back to the default, so the empty first attempt was retried",
  );
});
