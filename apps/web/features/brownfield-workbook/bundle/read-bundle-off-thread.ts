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
  return new Promise((resolve) => {
    let worker: WorkerLike;
    try {
      worker = createWorker();
    } catch {
      // Worker constructor unavailable (e.g. `typeof Worker === "undefined"`) or
      // refused by the host: read inline.
      void readBundle(data, limits).then(resolve);
      return;
    }

    let settled = false;
    const finish = (result: ReadBundleResult) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    };
    const fallback = () => {
      if (settled) return;
      // `data` was posted as a *copy* (transferred separately), so the buffer
      // backing `data` is still intact here. `finish` terminates the worker once
      // the synchronous read is done.
      void readBundle(data, limits).then(finish);
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
    worker.postMessage({ data: copy, limits }, [copy]);
  });
}
