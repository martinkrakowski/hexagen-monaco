import type { Result } from "../../../shared/result";
import type { CreativeServiceError } from "../../errors/creative-service-error";

/**
 * Outbound port for the Firefly Generate service.
 *
 * One method per operation; each is async under the hood (submit → await job) but
 * presents a single `Result`-returning call resolving to the generated output
 * href(s). Hrefs are presigned URLs (`storage: "external"`) — supply them
 * yourself (core passthrough) or let a storage addon presign them.
 *
 * Generation knobs (model, size, variations, seed) and the policy flags
 * (`contentCredentials`, `safety`) are pass-through {@link GenerateOptions}, never
 * hardcoded in the adapter.
 */
export interface GenerateOptions {
  /** Model id; defaults to ADOBE_FIREFLY_DEFAULT_MODEL. */
  readonly model?: string;
  /** Output size as "WIDTHxHEIGHT"; defaults to the install-configured size. */
  readonly size?: string;
  /** Number of variations to request. */
  readonly numVariations?: number;
  /** Seed for reproducible output. */
  readonly seed?: number;
  /** Attach Content Credentials (C2PA) to outputs. */
  readonly contentCredentials?: boolean;
  /** Safety / moderation settings passed through to the API verbatim. */
  readonly safety?: Record<string, unknown>;
}

export interface TextToImageRequest extends GenerateOptions {
  readonly prompt: string;
  /** Presigned destination the output is written to. */
  readonly outputHref: string;
}

export interface ImageEditRequest extends GenerateOptions {
  /** Presigned source image the service reads. */
  readonly inputHref: string;
  /** Presigned destination the output is written to. */
  readonly outputHref: string;
  /** Optional text prompt steering the edit. */
  readonly prompt?: string;
  /** Presigned mask href (fill/expand). */
  readonly maskHref?: string;
}

export interface ImageGenerationPort {
  /** Generate image(s) from a text prompt. */
  textToImage(req: TextToImageRequest): Promise<Result<string[], CreativeServiceError>>;
  /** Fill a masked region of an image. */
  generativeFill(req: ImageEditRequest): Promise<Result<string[], CreativeServiceError>>;
  /** Extend an image beyond its original bounds. */
  generativeExpand(req: ImageEditRequest): Promise<Result<string[], CreativeServiceError>>;
  /** Generate a new image conditioned on a reference image. */
  imageToImage(req: ImageEditRequest): Promise<Result<string[], CreativeServiceError>>;
  /** Apply the style of a reference image to a generation. */
  styleTransfer(req: ImageEditRequest): Promise<Result<string[], CreativeServiceError>>;
}
