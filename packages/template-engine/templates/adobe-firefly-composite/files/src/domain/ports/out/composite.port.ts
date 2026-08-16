import type { Result } from "../../../shared/result";
import type { CreativeServiceError } from "../../errors/creative-service-error";

/**
 * Outbound port for the Firefly Composite Operations service.
 *
 * Blends a product image into a scene so its tone, lighting, and shadow match.
 * Async under the hood; returns **multiple candidate** composites, so the port
 * resolves to an array of output hrefs. Hrefs are presigned URLs
 * (`storage: "external"`).
 */
export interface CompositeOptions {
  /** Model id; defaults to ADOBE_FIREFLY_DEFAULT_MODEL. */
  readonly model?: string;
  /** How many candidate composites to request; defaults to the install value. */
  readonly numVariations?: number;
  /** Attach Content Credentials (C2PA) to outputs. */
  readonly contentCredentials?: boolean;
  /** Safety / moderation settings passed through to the API verbatim. */
  readonly safety?: Record<string, unknown>;
}

export interface CompositeRequest extends CompositeOptions {
  /** Presigned product image (the subject to place into the scene). */
  readonly productHref: string;
  /** Presigned scene/background image. */
  readonly sceneHref: string;
  /** Presigned destination the composites are written to. */
  readonly outputHref: string;
  /** Optional prompt steering the blend. */
  readonly prompt?: string;
}

export interface CompositePort {
  /** Composite `productHref` into `sceneHref`; resolves to candidate output hrefs. */
  composite(req: CompositeRequest): Promise<Result<string[], CreativeServiceError>>;
}
