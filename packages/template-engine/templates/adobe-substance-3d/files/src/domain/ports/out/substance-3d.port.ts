import type { Result } from "../../../shared/result";
import type { CreativeServiceError } from "../../errors/creative-service-error";

/**
 * Outbound port for the Adobe Substance 3D API (image.adobe.io).
 *
 * Compute-heavy 3D automation: render a scene to a 2D image, composite a render
 * over a background plate, or relight a scene with a new lighting environment.
 * Async and the longest-running of the Firefly services. Every method resolves
 * to the output href. Hrefs are presigned URLs (`storage: "external"`).
 */
export type Substance3DFormat = "png" | "jpg";

export interface Substance3DRequest {
  /** Presigned input scene/mesh/material href. */
  readonly inputHref: string;
  /** Presigned destination the rendered image is written to. */
  readonly outputHref: string;
  /** Output format; defaults to the install-configured format. */
  readonly format?: Substance3DFormat;
}

/** Render a 3D scene to a 2D image. */
export type RenderRequest = Substance3DRequest;

export interface CompositeRequest extends Substance3DRequest {
  /** Presigned background plate the 3D render is composited over. */
  readonly backgroundHref: string;
}

export interface RelightRequest extends Substance3DRequest {
  /** Presigned lighting environment (HDRI) the scene is relit with. */
  readonly environmentHref: string;
}

export interface Substance3DPort {
  /** Render a scene to an image. */
  render(req: RenderRequest): Promise<Result<string, CreativeServiceError>>;
  /** Composite a render over a background plate. */
  composite(req: CompositeRequest): Promise<Result<string, CreativeServiceError>>;
  /** Relight a scene with a new lighting environment. */
  relight(req: RelightRequest): Promise<Result<string, CreativeServiceError>>;
}
