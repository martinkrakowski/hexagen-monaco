import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { follow } from "../../src/lane-watch/follow.js";
import { SESSION, frame, heartbeat, idle } from "./fixtures.js";

/**
 * The stall rules on a fake clock, so a slow machine cannot fail them. `get` is
 * an in-memory stand-in for the one request helper: it honours the abort signal
 * the way a real `fetch` does, and hands the test the stream it writes into.
 */
const STALL_MS = 300;
const encoder = new TextEncoder();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

interface Rig {
  readonly controller: AbortController;
  readonly out: string[];
  readonly err: string[];
  readonly run: Promise<number>;
  readonly write: (text: string) => void;
  readonly connect: () => void;
}

function rig(opts: { connected: boolean }): Rig {
  const controller = new AbortController();
  const out: string[] = [];
  const err: string[] = [];
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      stream = c;
    },
  });
  let release!: () => void;
  const connectedPromise = new Promise<void>((done) => (release = done));
  if (opts.connected) release();
  const get = (): Promise<Response> =>
    new Promise((resolve, reject) => {
      const onAbort = (): void => {
        stream.error(new Error("aborted"));
        reject(new Error("aborted"));
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      void connectedPromise.then(() => resolve(new Response(body)));
    });
  const run = follow({
    get,
    controller,
    session: SESSION,
    stallMs: STALL_MS,
    log: (text) => out.push(text),
    logError: (text) => err.push(text),
  });
  return {
    controller,
    out,
    err,
    run,
    write: (text) => stream.enqueue(encoder.encode(text)),
    connect: release,
  };
}

const toolFor = (sessionID: string): string =>
  frame("message.part.updated", {
    part: { type: "tool", tool: "bash", sessionID, state: { status: "x" } },
  });

describe("follow's stall timer on a fake clock", () => {
  test("server.heartbeat frames do not reset it", async () => {
    const r = rig({ connected: true });
    for (let i = 0; i < 2; i += 1) {
      r.write(heartbeat());
      await vi.advanceTimersByTimeAsync(100);
    }
    r.write(heartbeat());
    await vi.advanceTimersByTimeAsync(100);
    expect(await r.run).toBe(4);
    expect(r.controller.signal.aborted).toBe(true);
  });

  test("events of another session do not reset it", async () => {
    const r = rig({ connected: true });
    for (let i = 0; i < 3; i += 1) {
      r.write(toolFor("ses_other"));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(await r.run).toBe(4);
  });

  test("it is armed before the connection: a connect that never answers stalls", async () => {
    const r = rig({ connected: false });
    await vi.advanceTimersByTimeAsync(STALL_MS - 1);
    expect(r.controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await r.run).toBe(4);
    expect(r.controller.signal.aborted).toBe(true);
  });

  test("the session's own frames, deltas included, keep it alive", async () => {
    const r = rig({ connected: true });
    for (let i = 0; i < 7; i += 1) {
      r.write(frame("message.part.delta", { sessionID: SESSION, delta: "x" }));
      await vi.advanceTimersByTimeAsync(100);
    }
    r.write(idle());
    expect(await r.run).toBe(0);
  });

  test("a stall says how long, and points at usage for a lane that finished first", async () => {
    const r = rig({ connected: true });
    await vi.advanceTimersByTimeAsync(STALL_MS);
    expect(await r.run).toBe(4);
    expect(r.err.join("\n")).toContain(
      'stall: no events for 0.3 s (if the lane finished before follow connected, run "lane-watch usage")',
    );
  });

  test("no timer is left pending after a normal finish", async () => {
    const r = rig({ connected: true });
    r.write(idle());
    expect(await r.run).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
