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
 */
export function readBundleOffThread(
  data: Uint8Array,
  limits?: BundleLimits,
  createWorker: () => WorkerLike = createDefaultWorker,
): Promise<ReadBundleResult> {
  return new Promise((resolve, reject) => {
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
    const finish = (result: ReadBundleResult) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(cause);
    };
    let fellBack = false;
    const fallback = () => {
      if (settled || fellBack) return;
      fellBack = true;
      // `data` was posted as a *copy* (transferred separately), so the buffer
      // backing `data` is still intact here. The worker is terminated when the
      // main-thread read settles, whichever way: a rejection is passed on, never
      // swallowed, so the caller is not left waiting for ever.
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
