import { describe, it, expect } from "vitest";
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
});
