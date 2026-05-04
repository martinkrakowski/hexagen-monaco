import { ok, err, type Result } from "@hexagen/shared";

export function probeCacheViaWorker(
  worker: Worker,
  mlcModelId: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      worker.removeEventListener("message", handler);
      reject(new Error("hasModelInCache timed out after 60s"));
    }, 60000);

    const handler = (e: MessageEvent) => {
      if (
        e.data?.type === "has-model-in-cache-result" &&
        e.data?.data?.modelId === mlcModelId
      ) {
        clearTimeout(timeoutId);
        worker.removeEventListener("message", handler);
        resolve(e.data?.data?.isCached === true);
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({
      type: "has-model-in-cache",
      data: { modelId: mlcModelId },
    });
  });
}

export function deleteViaWorker(
  worker: Worker,
  mlcModelId: string,
): Promise<Result<void>> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      worker.removeEventListener("message", handler);
      resolve(err(new Error("Delete model cache timed out after 60s")));
    }, 60000);

    const handler = (e: MessageEvent) => {
      if (
        e.data?.type === "delete-cached-model-result" &&
        e.data?.data?.modelId === mlcModelId
      ) {
        clearTimeout(timeoutId);
        worker.removeEventListener("message", handler);
        if (e.data?.data?.error) {
          resolve(err(new Error(e.data.data.error)));
        } else {
          resolve(ok(undefined));
        }
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({
      type: "delete-cached-model",
      data: { modelId: mlcModelId },
    });
  });
}
