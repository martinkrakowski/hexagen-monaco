import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useGithubScan } from "./useGithubScan";

/**
 * The transport half of S2 (BF-5.3).
 *
 * `scan-stream.test.ts` covers the protocol; what is asserted here is only what
 * the hook adds: the availability probe, the pre-stream failure statuses, a
 * stream that ends without a terminal frame, a terminal frame that arrives
 * without its trailing newline, and the property that a dropped connection is
 * REPORTED rather than silently retried — a retry here would spend a second
 * daily scan and start a second clone.
 */

const ENDPOINT = "/api/projects/scan/github";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A body that yields the given chunks, then ends. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encode(chunk));
      controller.close();
    },
  });
}

interface FakeResponseInit {
  status?: number;
  body?: ReadableStream<Uint8Array> | null;
  text?: string;
  headers?: Record<string, string>;
}

function fakeResponse(init: FakeResponseInit = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: init.body ?? null,
    headers: new Headers(init.headers ?? {}),
    text: async () => init.text ?? "",
  } as unknown as Response;
}

/** `GET` answers 405 when the feature is on — the route mirrors POST's switch. */
const PROBE_ON = fakeResponse({ status: 405 });
const PROBE_OFF = fakeResponse({ status: 404 });

function frame(payload: Record<string, unknown>): string {
  return `${JSON.stringify({ runId: "run-1", ...payload })}\n`;
}

const DONE_RESULT = {
  verdict: "pass",
  exitCode: 0,
  projectName: "checkout",
  layoutExcerpt: null,
  filesScanned: 12,
  reportMarkdown: null,
  errorMessage: null,
};

const REQUEST = {
  projectName: "checkout",
  repoReference: "acme/checkout",
  ref: "",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Route each call by method so a test only has to describe the POST. */
function respond(
  post: Response | (() => Response),
  probe: Response = PROBE_ON,
) {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    Promise.resolve(
      (init?.method ?? "GET") === "GET"
        ? probe
        : typeof post === "function"
          ? post()
          : post,
    ),
  );
}

function postCalls() {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
}

describe("useGithubScan — availability probe", () => {
  it("reports the kill switch as `not-enabled`, not as a failure", async () => {
    respond(fakeResponse({ status: 404 }), PROBE_OFF);
    const { result } = renderHook(() => useGithubScan());
    await waitFor(() =>
      expect(result.current.availability).toBe("not-enabled"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reads the route's 405 as `available`", async () => {
    respond(fakeResponse({ status: 200, body: streamOf([]) }));
    const { result } = renderHook(() => useGithubScan());
    await waitFor(() => expect(result.current.availability).toBe("available"));
  });

  it("leaves availability `unknown` when the probe itself fails", async () => {
    // A proxy that rewrites errors must not be able to hide a working feature
    // behind a "not available" screen.
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGithubScan());
    await waitFor(() => expect(result.current.availability).toBe("unknown"));
  });
});

describe("useGithubScan — streaming", () => {
  it("folds a complete run and settles on the `done` payload", async () => {
    respond(
      fakeResponse({
        body: streamOf([
          frame({
            type: "stage-start",
            stage: 0,
            label: "Clone",
            repo: "acme/checkout",
            ref: "main",
          }),
          frame({ type: "chunk", stage: 0, data: "Cloning…" }),
          frame({ type: "stage-complete", stage: 0, durationMs: 1900 }),
          frame({ type: "stage-start", stage: 1, label: "Scan" }),
          frame({ type: "stage-complete", stage: 1, durationMs: 4200 }),
          frame({ type: "done", result: DONE_RESULT }),
        ]),
      }),
    );

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => result.current.start(REQUEST));

    expect(settled.phase).toBe("complete");
    expect(settled.outcome?.filesScanned).toBe(12);
    expect(settled.runId).toBe("run-1");
    expect(settled.repoLabel).toBe("acme/checkout @ main");
    expect(result.current.run.phase).toBe("complete");
  });

  it("sends the ref only when one was typed", async () => {
    respond(
      fakeResponse({
        body: streamOf([frame({ type: "done", result: DONE_RESULT })]),
      }),
    );
    const { result } = renderHook(() => useGithubScan());

    await act(async () => result.current.start({ ...REQUEST, ref: "  " }));
    expect(JSON.parse(String(postCalls()[0][1].body))).toEqual({
      name: "checkout",
      repoUrl: "acme/checkout",
    });

    respond(
      fakeResponse({
        body: streamOf([frame({ type: "done", result: DONE_RESULT })]),
      }),
    );
    await act(async () =>
      result.current.start({ ...REQUEST, ref: " release/2.0 " }),
    );
    expect(JSON.parse(String(postCalls().at(-1)?.[1].body)).ref).toBe(
      "release/2.0",
    );
  });

  it("stops at an `error` frame and never falls through to a partial success", async () => {
    respond(
      fakeResponse({
        body: streamOf([
          frame({ type: "stage-start", stage: 0, label: "Clone" }),
          frame({
            type: "error",
            code: "repo_too_large",
            message: "That repository is too large to scan here.",
            reason: "preflight",
          }),
          // A server that keeps talking after a terminal frame.
          frame({ type: "done", result: DONE_RESULT }),
        ]),
      }),
    );

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => result.current.start(REQUEST));

    expect(settled.phase).toBe("blocked");
    expect(settled.outcome).toBeNull();
    expect(settled.failure?.title).toBe(
      "That repository is too large to scan here",
    );
  });

  it("reports a stream that ends mid-clone instead of retrying it", async () => {
    // Retrying would re-POST, which charges a SECOND daily scan and starts a
    // second clone. The dropped connection has to be surfaced, not papered over.
    respond(
      fakeResponse({
        body: streamOf([
          frame({ type: "stage-start", stage: 0, label: "Clone" }),
          frame({
            type: "chunk",
            stage: 0,
            data: "Receiving objects",
            receivedBytes: 4096,
          }),
        ]),
      }),
    );

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => result.current.start(REQUEST));

    expect(settled.phase).toBe("blocked");
    expect(settled.failure?.title).toBe("The scan stopped before it finished");
    expect(settled.failure?.code).toBe("stream-eof");
    expect(postCalls()).toHaveLength(1);
  });

  it("reads a terminal frame that arrived without its trailing newline", async () => {
    respond(
      fakeResponse({
        body: streamOf([
          frame({ type: "stage-start", stage: 0, label: "Clone" }),
          JSON.stringify({
            runId: "run-1",
            type: "error",
            code: "timeout",
            message: "The scan exceeded its time budget and was stopped.",
          }),
        ]),
      }),
    );

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => result.current.start(REQUEST));

    // Without the residual flush this run would end as a generic truncation,
    // silently downgrading a reported failure.
    expect(settled.failure?.code).toBe("timeout");
    expect(settled.failure?.title).toBe("The scan ran out of time");
  });

  it("splits frames on buffer boundaries, not on chunk boundaries", async () => {
    const complete = frame({ type: "done", result: DONE_RESULT });
    respond(
      fakeResponse({
        body: streamOf([
          complete.slice(0, 12),
          complete.slice(12, 40),
          complete.slice(40),
        ]),
      }),
    );

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => result.current.start(REQUEST));
    expect(settled.phase).toBe("complete");
  });
});

describe("useGithubScan — failures before the stream opens", () => {
  it("turns a 404 into `not available here` and flips availability with it", async () => {
    respond(fakeResponse({ status: 404, text: '{"error":"Not found"}' }));
    const { result } = renderHook(() => useGithubScan());
    await waitFor(() => expect(result.current.availability).toBe("available"));

    const settled = await act(async () => result.current.start(REQUEST));

    expect(settled.failure?.code).toBe("not-enabled");
    expect(settled.failure?.detail).toMatch(/switched off, not broken/);
    expect(result.current.availability).toBe("not-enabled");
  });

  it("reads the daily-quota 429's own message out of its NDJSON frame", async () => {
    respond(
      fakeResponse({
        status: 429,
        text: `${JSON.stringify({
          type: "error",
          code: "quota_exhausted",
          message:
            "You've reached the free-tier daily limit of 3 project scans. It resets at midnight UTC.",
          runId: "run-1",
        })}\n`,
        headers: { "Retry-After": "3600" },
      }),
    );

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => result.current.start(REQUEST));

    expect(settled.failure?.title).toBe("Today's scan limit has been reached");
    expect(settled.failure?.detail).toMatch(/daily limit of 3 project scans/);
  });

  it("tells the per-IP rate-limit 429 apart by the ABSENCE of a frame", async () => {
    respond(
      fakeResponse({
        status: 429,
        text: JSON.stringify({
          success: false,
          error: "Too many requests. Please slow down.",
        }),
        headers: { "Retry-After": "20" },
      }),
    );

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => result.current.start(REQUEST));

    expect(settled.failure?.title).toBe("Too many scans in a short time");
    expect(settled.failure?.hint).toMatch(/about 20 seconds/);
  });

  it("reports a fetch that never reached the server", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? Promise.resolve(PROBE_ON)
        : Promise.reject(new Error("Failed to fetch")),
    );

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => result.current.start(REQUEST));

    expect(settled.phase).toBe("blocked");
    expect(settled.failure?.detail).toBe("Failed to fetch");
    expect(settled.failure?.code).toBe("stream-transport");
  });
});

describe("useGithubScan — cancelling", () => {
  it("settles as `cancelled`, which is not a failure", async () => {
    // The fake body honours the abort signal the way a real `fetch` body does:
    // aborting errors the stream, so the pending read rejects. Without that the
    // read on a never-closing body would hang and the test would prove nothing.
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return Promise.resolve(PROBE_ON);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encode(frame({ type: "stage-start", stage: 0, label: "Clone" })),
          );
          init?.signal?.addEventListener(
            "abort",
            () => {
              controller.error(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            },
            { once: true },
          );
        },
      });
      return Promise.resolve(fakeResponse({ body }));
    });

    const { result } = renderHook(() => useGithubScan());
    const settled = await act(async () => {
      const pending = result.current.start(REQUEST);
      // Let the read loop open the stream before pulling the plug.
      await new Promise((resolve) => setTimeout(resolve, 0));
      result.current.cancel();
      return pending;
    });

    expect(settled.phase).toBe("cancelled");
    expect(settled.failure).toBeNull();
    expect(settled.outcome).toBeNull();
  });
});
