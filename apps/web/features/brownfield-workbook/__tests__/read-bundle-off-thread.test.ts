import { describe, it, expect, vi } from "vitest";

// The real reader, wrapped so a single call can be made to reject: the
// fallback's failure path is otherwise unreachable from a test.
vi.mock("../bundle/read-bundle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bundle/read-bundle")>();
  return { ...actual, readBundle: vi.fn(actual.readBundle) };
});

import { readBundle } from "../bundle/read-bundle";
import {
  readBundleOffThread,
  type WorkerLike,
} from "../bundle/read-bundle-off-thread";
import { buildBundle } from "./bundle-fixtures";

class FakeWorker implements WorkerLike {
  readonly calls: unknown[] = [];
  readonly transfers: unknown[] = [];
  terminateCount = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor(private behavior: (self: FakeWorker) => void = () => {}) {}

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.calls.push(message);
    if (transfer) this.transfers.push(...transfer);
    queueMicrotask(() => this.behavior(this));
  }

  terminate(): void {
    this.terminateCount++;
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError(): void {
    this.onerror?.({ message: "worker error" } as ErrorEvent);
  }
}

describe("readBundleOffThread", () => {
  it("a. resolves with the worker's result on { ok: true }", async () => {
    const data = await buildBundle();
    const result = await readBundle(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const worker = new FakeWorker((self) => {
      self.emitMessage({ ok: true, result });
    });

    const out = await readBundleOffThread(data, undefined, () => worker);

    expect(out).toBe(result);
    expect(worker.calls).toHaveLength(1);
    const msg = worker.calls[0] as { data: ArrayBuffer; limits: unknown };
    expect(msg.data).toBeInstanceOf(ArrayBuffer);
    expect(msg.data.byteLength).toBe(data.length);
    expect(worker.terminateCount).toBe(1);
  });

  it("b. the input Uint8Array is still readable after the call", async () => {
    const data = await buildBundle();
    const result = await readBundle(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const worker = new FakeWorker((self) => {
      self.emitMessage({ ok: true, result });
    });

    const originalLength = data.length;
    const firstByte = data[0];

    await readBundleOffThread(data, undefined, () => worker);

    expect(data.length).toBe(originalLength);
    expect(data[0]).toBe(firstByte);
  });

  it("c. worker onerror falls back to readBundle on the main thread", async () => {
    const data = await buildBundle();
    const expected = await readBundle(data);

    const worker = new FakeWorker((self) => {
      self.emitError();
    });

    const out = await readBundleOffThread(data, undefined, () => worker);

    expect(out).toEqual(expected);
    expect(worker.terminateCount).toBe(1);
  });

  it("d. worker posts { ok: false } -> same fallback result", async () => {
    const data = await buildBundle();
    const expected = await readBundle(data);

    const worker = new FakeWorker((self) => {
      self.emitMessage({ ok: false });
    });

    const out = await readBundleOffThread(data, undefined, () => worker);

    expect(out).toEqual(expected);
  });

  it("e. createWorker throws -> same fallback result", async () => {
    const data = await buildBundle();
    const expected = await readBundle(data);

    const out = await readBundleOffThread(data, undefined, () => {
      throw new Error("cannot create worker");
    });

    expect(out).toEqual(expected);
  });

  it("f. Worker undefined (jsdom) and no createWorker -> fallback", async () => {
    expect(typeof Worker).toBe("undefined");

    const data = await buildBundle();
    const expected = await readBundle(data);

    const out = await readBundleOffThread(data);

    expect(out).toEqual(expected);
  });

  it("g. a late second message or error after the first answer does not change the result", async () => {
    const data = await buildBundle();
    const result = await readBundle(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const worker = new FakeWorker((self) => {
      self.emitMessage({ ok: true, result });
      queueMicrotask(() => {
        self.emitMessage({ ok: true, result: { ok: false, errors: ["late"] } });
        self.emitError();
      });
    });

    const out = await readBundleOffThread(data, undefined, () => worker);

    expect(out).toBe(result);
    expect(worker.terminateCount).toBe(1);
  });

  it("h. a main-thread read that REJECTS after a worker error rejects the call, and the worker is terminated", async () => {
    const data = await buildBundle();
    const worker = new FakeWorker((self) => self.emitError());
    vi.mocked(readBundle).mockRejectedValueOnce(new Error("boom"));

    await expect(
      readBundleOffThread(data, undefined, () => worker),
    ).rejects.toThrow("boom");
    expect(worker.terminateCount).toBe(1);
  });

  it("i. with no worker at all, a rejecting read rejects the call instead of never settling", async () => {
    const data = await buildBundle();
    vi.mocked(readBundle).mockRejectedValueOnce(new Error("boom"));

    await expect(
      readBundleOffThread(data, undefined, () => {
        throw new Error("no worker");
      }),
    ).rejects.toThrow("boom");
  });

  it("j. a postMessage that throws falls back to the main-thread result", async () => {
    const data = await buildBundle();
    const expected = await readBundle(data);
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new Error("DataCloneError");
    };

    const out = await readBundleOffThread(data, undefined, () => worker);

    expect(out).toEqual(expected);
    expect(worker.terminateCount).toBe(1);
  });

  it("k. aborting stops the worker and rejects with an AbortError", async () => {
    const data = await buildBundle();
    const worker = new FakeWorker(); // never answers
    const controller = new AbortController();

    const pending = readBundleOffThread(
      data,
      undefined,
      () => worker,
      controller.signal,
    );
    expect(worker.calls).toHaveLength(1); // the read really started
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminateCount).toBe(1);
  });

  it("l. a signal that is already aborted starts no worker at all", async () => {
    const data = await buildBundle();
    let created = 0;
    const controller = new AbortController();
    controller.abort();

    await expect(
      readBundleOffThread(
        data,
        undefined,
        () => {
          created++;
          return new FakeWorker();
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(created).toBe(0);
  });

  it("m. aborting after the read finished changes nothing", async () => {
    const data = await buildBundle();
    const result = await readBundle(data);
    const worker = new FakeWorker((self) =>
      self.emitMessage({ ok: true, result }),
    );
    const controller = new AbortController();

    const out = await readBundleOffThread(
      data,
      undefined,
      () => worker,
      controller.signal,
    );
    controller.abort();

    expect(out).toBe(result);
    expect(worker.terminateCount).toBe(1);
  });

  it("n. on fallback the worker is stopped BEFORE the main-thread read starts, and only once", async () => {
    const data = await buildBundle();
    const worker = new FakeWorker((self) => self.emitError());
    let terminatedWhenReadStarted = -1;
    vi.mocked(readBundle).mockImplementationOnce(async () => {
      terminatedWhenReadStarted = worker.terminateCount;
      return { ok: false, errors: ["stub"] };
    });

    const out = await readBundleOffThread(data, undefined, () => worker);

    expect(out).toEqual({ ok: false, errors: ["stub"] });
    expect(terminatedWhenReadStarted).toBe(1);
    expect(worker.terminateCount).toBe(1);
  });
});
