import type { Result } from "../../../shared/result";
import type { CreativeServiceError } from "../../errors/creative-service-error";

/**
 * Outbound port for the Adobe Lightroom API (image.adobe.io/lrService).
 *
 * Batch-oriented photo editing / color grading. Async under the hood; every method
 * resolves to the output href. Hrefs are presigned URLs (`storage: "external"`).
 */
export interface LightroomRequest {
  /** Presigned input image href. */
  readonly inputHref: string;
  /** Presigned destination the edited image is written to. */
  readonly outputHref: string;
}

export interface ApplyPresetRequest extends LightroomRequest {
  /** Presigned href of a Lightroom preset (XMP). */
  readonly presetHref: string;
}

export interface EditRequest extends LightroomRequest {
  /** Lightroom edit parameters (exposure, contrast, …) passed through verbatim. */
  readonly edits: Record<string, unknown>;
}

export interface LightroomPort {
  /** Auto-tone an image (automatic exposure/colour correction). */
  autoTone(req: LightroomRequest): Promise<Result<string, CreativeServiceError>>;
  /** Apply a Lightroom preset (XMP) to an image. */
  applyPreset(req: ApplyPresetRequest): Promise<Result<string, CreativeServiceError>>;
  /** Apply explicit edit parameters to an image. */
  edit(req: EditRequest): Promise<Result<string, CreativeServiceError>>;
}
