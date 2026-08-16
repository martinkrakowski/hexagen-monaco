import type { Result } from "../../../shared/result";
import type { CreativeServiceError } from "../../errors/creative-service-error";

/**
 * Outbound port for the Adobe Firefly Custom Models API.
 *
 * Train a brand-tuned model from a curated dataset, check its status, list the
 * project's models, and generate images with a trained model. Training is
 * long-running (minutes–hours) and webhook-friendly. Hrefs are presigned URLs
 * (`storage: "external"`).
 */
export type CustomModelStatus =
  | "queued"
  | "training"
  | "completed"
  | "failed"
  // An API state the adapter doesn't recognise (e.g. a newly introduced or
  // terminal-but-unmapped status like "cancelled"/"archived") — reported as-is
  // rather than guessed as "queued" (would poll forever) or "failed" (would
  // mislabel a still-progressing state).
  | "unknown";

export interface TrainRequest {
  /** Display name for the custom model. */
  readonly name: string;
  /**
   * Presigned dataset ref — a curated set of 10–50 on-brand images plus captions
   * (the install-configured format). Upload it to your storage first; the adapter
   * presigns it for the training job.
   */
  readonly datasetHref: string;
  /** Base model to fine-tune from; defaults to the install-configured base model. */
  readonly baseModel?: string;
}

export interface TrainedModel {
  /** The custom model id (pass to {@link CustomModelPort.generateWith}). */
  readonly modelId: string;
  /** Display name, when the API returns one. */
  readonly name?: string;
  /** Training lifecycle state. */
  readonly status: CustomModelStatus;
}

export interface GenerateWithRequest {
  /** The trained custom model id. */
  readonly modelId: string;
  /** Text prompt. */
  readonly prompt: string;
  /** Presigned destination the result is written to. */
  readonly outputHref: string;
  /** Number of variations to request. */
  readonly numVariations?: number;
  /** Per-call seed for reproducibility. */
  readonly seed?: number;
}

export interface CustomModelPort {
  /**
   * Submit a training job and await it over `queued → training → completed`.
   * Resolves to the trained model id.
   */
  train(req: TrainRequest): Promise<Result<string, CreativeServiceError>>;
  /** Fetch a model's current training status. */
  status(modelId: string): Promise<Result<TrainedModel, CreativeServiceError>>;
  /** List the project's custom models. */
  list(): Promise<Result<TrainedModel[], CreativeServiceError>>;
  /**
   * Generate images with a trained custom model. Resolves to one output href per
   * variation, in request order.
   */
  generateWith(
    req: GenerateWithRequest,
  ): Promise<Result<string[], CreativeServiceError>>;
}
