// @hexagen-server-only
import type {
  CustomModelPort,
  CustomModelStatus,
  GenerateWithRequest,
  TrainRequest,
  TrainedModel,
} from "../../../domain/ports/out/custom-model.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Firefly Custom Models adapter — the boundary for {@link CustomModelPort}.
 *
 * Custom Models runs on the core firefly-api host (the shared `fireflyClient`
 * posts RELATIVE paths), so training and inference jobs are awaited via
 * `FireflyJobPort` (polling OR webhook, transparently) — NOT the always-poll path
 * the other-host (image) services use.
 *
 * Training is the LONGEST operation in the family (minutes–hours). Prefer webhook
 * job_mode and raise ADOBE_WEBHOOK_TIMEOUT_MS; if polling, scale
 * ADOBE_JOB_POLL_INTERVAL_MS up.
 *
 * Dataset caption format set at install: {dataset_caption_format}.
 *
 * NOTE: paths/payloads version frequently — verify against Adobe docs.
 */
const DEFAULT_BASE_MODEL =
  process.env.ADOBE_FIREFLY_BASE_MODEL?.trim() || "firefly_v3";
const DATASET_CAPTION_FORMAT = "{dataset_caption_format}";

export class FireflyCustomModelAdapter implements CustomModelPort {
  async train(req: TrainRequest): Promise<Result<string, FireflyError>> {
    try {
      // The dataset is already uploaded to storage; presign it so Firefly can read it.
      const dataset = await getStoragePresigner().presignInput(req.datasetHref);
      const handle = toJobHandle(
        await fireflyClient.post("/v3/custom-models/train-async", {
          name: req.name,
          baseModel: req.baseModel?.trim() || DEFAULT_BASE_MODEL,
          dataset: { href: dataset.href, storage: "external" },
          captionFormat: DATASET_CAPTION_FORMAT,
        }),
      );
      if (!handle.jobId) {
        return err(
          new FireflyError(
            "Custom-model train submit did not include a job id.",
          ),
        );
      }
      // Await transparently polls or resolves a webhook over queued→training→completed.
      const done = await jobPort.await(handle);
      if (done.status !== "succeeded") {
        return err(
          new FireflyError(done.error ?? "Custom-model training did not complete."),
        );
      }
      const modelId = extractModelId(done.outputs[0]);
      if (!modelId) {
        return err(
          new FireflyError(
            "Custom-model training completed without a model id (verify the result field against Adobe docs).",
          ),
        );
      }
      return ok(modelId);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }

  async status(modelId: string): Promise<Result<TrainedModel, FireflyError>> {
    try {
      const raw = await fireflyClient.get<unknown>(
        `/v3/custom-models/${encodeURIComponent(modelId)}`,
      );
      return ok(toTrainedModel(raw));
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }

  async list(): Promise<Result<TrainedModel[], FireflyError>> {
    try {
      const raw = await fireflyClient.get<unknown>("/v3/custom-models");
      const models = (raw as { models?: unknown[] })?.models;
      const items = Array.isArray(models) ? models : [];
      return ok(items.map(toTrainedModel));
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }

  async generateWith(
    req: GenerateWithRequest,
  ): Promise<Result<string[], FireflyError>> {
    try {
      const output = await getStoragePresigner().presignOutput(req.outputHref);
      const body: Record<string, unknown> = {
        model: req.modelId,
        prompt: req.prompt,
        output: { href: output.href, storage: "external" },
      };
      if (req.numVariations !== undefined) body.numVariations = req.numVariations;
      if (req.seed !== undefined) body.seed = req.seed;

      const handle = toJobHandle(
        await fireflyClient.post("/v3/images/generate-async", body),
      );
      if (!handle.jobId) {
        return err(
          new FireflyError(
            "Custom-model generate submit did not include a job id.",
          ),
        );
      }
      const done = await jobPort.await(handle);
      const hrefs = done.outputs
        .map((o) => o.href)
        .filter((h): h is string => typeof h === "string" && h.length > 0);
      if (done.status !== "succeeded" || hrefs.length === 0) {
        return err(
          new FireflyError(
            done.error ?? "Custom-model generation produced no output.",
          ),
        );
      }
      return ok(hrefs);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }
}

// The trained model id arrives in the completed job's result payload (`data`, via
// parseJobResult), not as an asset href. Accept the common id field names.
function extractModelId(
  output: { href?: string; data?: unknown } | undefined,
): string | undefined {
  const data = output?.data as { modelId?: string; id?: string } | undefined;
  return data?.modelId ?? data?.id;
}

function toTrainedModel(raw: unknown): TrainedModel {
  const r = (raw ?? {}) as {
    modelId?: string;
    id?: string;
    name?: string;
    status?: string;
  };
  return {
    modelId: r.modelId ?? r.id ?? "",
    name: r.name,
    status: normaliseStatus(r.status),
  };
}

function normaliseStatus(status: string | undefined): CustomModelStatus {
  switch (status) {
    case "queued":
    case "training":
    case "completed":
    case "failed":
      return status;
    case "succeeded":
    case "complete":
    case "done":
      return "completed";
    case "running":
    case "in_progress":
      return "training";
    default:
      // An unrecognised status (e.g. "cancelled"/"archived", or a status the API
      // adds later) — surface it honestly rather than guessing "queued" (poll
      // forever) or "failed" (mislabel a possibly-progressing state).
      return "unknown";
  }
}

/** Shared singleton. */
export const fireflyCustomModel = new FireflyCustomModelAdapter();
