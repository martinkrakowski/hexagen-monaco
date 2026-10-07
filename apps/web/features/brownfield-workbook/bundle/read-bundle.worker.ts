/**
 * Module worker: inflates and sha256-hashes a workbook bundle zip on the
 * worker thread so the viewer's main thread stays responsive.
 *
 * Receives `{ data: ArrayBuffer, limits?: BundleLimits }`, then posts back
 * `{ ok: true, result }` (the ReadBundleResult) or `{ ok: false }` if
 * readBundle threw. It performs no network access.
 */
import {
  readBundle,
  type BundleLimits,
  type ReadBundleResult,
} from "./read-bundle";

self.onmessage = (event: MessageEvent) => {
  const { data, limits } = event.data as {
    data: ArrayBuffer;
    limits?: BundleLimits;
  };
  readBundle(new Uint8Array(data), limits)
    .then((result: ReadBundleResult) => {
      self.postMessage({ ok: true, result });
    })
    .catch(() => {
      self.postMessage({ ok: false });
    });
};
