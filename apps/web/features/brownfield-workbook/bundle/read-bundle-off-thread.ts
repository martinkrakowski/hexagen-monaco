import {
  readBundle,
  type BundleLimits,
  type ReadBundleResult,
} from "./read-bundle";

/**
 * A minimal worker handle — enough for `readBundleOffThread` to drive a real
 * Worker or a test fake. Mirrors the surface we need from a browser Worker.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

const createDefaultWorker = (): WorkerLike => {
  if (typeof Worker === "undefined") {
    throw new Error("Web Worker constructor is not available");
  }
  return new Worker(new URL("./read-bundle.worker.ts", import.meta.url), {
    type: "module",
  });
};

/**
 * Reads a workbook bundle on a Web Worker, so the inflation and sha256 hashing
 * do not block the main thread. If the worker is unavailable or fails, it
 * falls back to `readBundle` on the main thread.
 *
 * The caller's `data` is never transferred: a detached copy is posted to the
 * worker (and that copy is placed in the transfer list), so the original
 * Uint8Array's buffer stays intact for the fallback path if the worker fails.
 *
 * `signal` stops the read: the worker is terminated and the promise rejects
 * with an AbortError. There is deliberately NO timeout: a 256 MiB bundle on a
 * slow machine legitimately takes long, and a fixed limit would refuse it.
 */
export function readBundleOffThread(
  data: Uint8Array,
  limits?: BundleLimits,
  createWorker: () => WorkerLike = createDefaultWorker,
  signal?: AbortSignal,
): Promise<ReadBundleResult> {
  return new Promise((resolve, reject) => {
    // An aborted read (the user chose another file, or left the page) must not
    // keep a worker inflating and hashing a bundle nobody will look at.
    const aborted = () =>
      new DOMException("the bundle read was superseded", "AbortError");
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    let worker: WorkerLike;
    try {
      worker = createWorker();
    } catch {
      // Worker constructor unavailable (e.g. `typeof Worker === "undefined"`) or
      // refused by the host: read inline.
      // A rejection must reach the caller (its catch shows "could not be
      // read"); a promise that never settles would leave the page on "Reading".
      readBundle(data, limits).then(resolve, reject);
      return;
    }

    let settled = false;
    let terminated = false;
    const stopWorker = () => {
      if (terminated) return;
      terminated = true;
      worker.terminate();
    };
    const onAbort = () => fail(aborted());
    const finish = (result: ReadBundleResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      stopWorker();
      resolve(result);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      stopWorker();
      reject(cause);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    let fellBack = false;
    const fallback = () => {
      if (settled || fellBack) return;
      fellBack = true;
      // The worker has failed: stop it now, so it cannot keep running beside
      // the main-thread read. `data` was posted as a *copy* (transferred
      // separately), so the buffer backing `data` is still intact here. A
      // rejection is passed on, never swallowed, so the caller is not left
      // waiting for ever.
      stopWorker();
      readBundle(data, limits).then(finish, fail);
    };

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as
        | { ok: true; result: ReadBundleResult }
        | { ok: false };
      if (settled) return;
      if (msg && typeof msg === "object" && msg.ok === true) {
        finish(msg.result);
      } else {
        fallback();
      }
    };
    worker.onerror = () => {
      fallback();
    };

    // Post a COPY and transfer it so the worker owns the bytes, but the
    // original `data` buffer is untouched for the fallback path.
    const copy = data.slice().buffer;
    try {
      worker.postMessage({ data: copy, limits }, [copy]);
    } catch {
      // The copy could not be handed over (for example a fake or a browser that
      // refuses the transfer): read on this thread instead.
      fallback();
    }
  });
}
