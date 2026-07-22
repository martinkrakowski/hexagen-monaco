import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";

import { streamChatTurn } from "../session/stream-chat-turn";

const originalFetch = global.fetch;

/** A body that emits the given raw chunks (exact bytes, no added newlines). */
function rawBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function respondWith(chunks: string[]) {
  global.fetch = vi.fn(
    async (): Promise<Response> =>
      ({ ok: true, status: 200, body: rawBody(chunks) }) as unknown as Response,
  ) as unknown as typeof fetch;
}

const chunkFrame = (content: string) =>
  `data: ${JSON.stringify({ type: "chunk", content })}\n`;
const DONE_FRAME = `data: ${JSON.stringify({ type: "done" })}\n`;

function run(overrides: { onChunk?: (c: string) => void } = {}) {
  return streamChatTurn({
    message: "hi",
    model: "test-model",
    signal: new AbortController().signal,
    ...overrides,
  });
}

describe("streamChatTurn", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("accumulates chunk frames and reports the FULL content on each onChunk", async () => {
    respondWith([chunkFrame("Hello"), chunkFrame(" world"), DONE_FRAME]);
    const seen: string[] = [];
    const result = await run({ onChunk: (c) => seen.push(c) });
    assert.deepEqual(result, { ok: true, content: "Hello world" });
    assert.deepEqual(seen, ["Hello", "Hello world"]);
  });

  it("reassembles a frame split across reads mid-JSON", async () => {
    const frame = chunkFrame("split across reads");
    respondWith([frame.slice(0, 12), frame.slice(12), DONE_FRAME]);
    const result = await run();
    assert.deepEqual(result, { ok: true, content: "split across reads" });
  });

  it("flushes a trailing frame emitted without a final newline", async () => {
    // The last chunk frame has NO trailing newline and there is no done
    // frame — the flush path must still deliver it.
    respondWith([
      chunkFrame("part one, "),
      `data: ${JSON.stringify({ type: "chunk", content: "part two" })}`,
    ]);
    const result = await run();
    assert.deepEqual(result, { ok: true, content: "part one, part two" });
  });

  it("tolerates CRLF-delimited frames", async () => {
    respondWith([
      `data: ${JSON.stringify({ type: "chunk", content: "crlf ok" })}\r\n` +
        `data: ${JSON.stringify({ type: "done" })}\r\n`,
    ]);
    const result = await run();
    assert.deepEqual(result, { ok: true, content: "crlf ok" });
  });

  it("skips malformed data lines and non-data noise without failing the turn", async () => {
    respondWith([
      ": keep-alive comment\n",
      "data: {not json}\n",
      chunkFrame("still fine"),
      DONE_FRAME,
    ]);
    const result = await run();
    assert.deepEqual(result, { ok: true, content: "still fine" });
  });

  it("an error frame surfaces its message (frames after it are ignored)", async () => {
    respondWith([
      chunkFrame("partial"),
      `data: ${JSON.stringify({ type: "error", message: "Daily quota exceeded" })}\n`,
      chunkFrame("ignored"),
    ]);
    const result = await run();
    assert.deepEqual(result, {
      ok: false,
      error: "Daily quota exceeded",
      aborted: false,
    });
  });

  it("a whitespace-only completion is rejected — an empty model turn must surface", async () => {
    respondWith([chunkFrame("   \n  "), DONE_FRAME]);
    const result = await run();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /no response/i);
      assert.equal(result.aborted, false);
    }
  });

  it("an HTTP error uses the JSON body's error message, falling back to the status", async () => {
    global.fetch = vi.fn(
      async (): Promise<Response> =>
        ({
          ok: false,
          status: 429,
          json: async () => ({ error: "Daily free-tier quota exceeded" }),
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    const withBody = await run();
    assert.deepEqual(withBody, {
      ok: false,
      error: "Daily free-tier quota exceeded",
      aborted: false,
    });

    global.fetch = vi.fn(
      async (): Promise<Response> =>
        ({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error("not json");
          },
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    const withoutBody = await run();
    assert.deepEqual(withoutBody, {
      ok: false,
      error: "HTTP 500",
      aborted: false,
    });
  });

  it("an abort is reported as aborted (callers park silently, not as an error)", async () => {
    const controller = new AbortController();
    global.fetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const pending = streamChatTurn({
      message: "hi",
      model: "test-model",
      signal: controller.signal,
    });
    controller.abort();
    const result = await pending;
    assert.deepEqual(result, { ok: false, error: "Aborted", aborted: true });
  });
});
