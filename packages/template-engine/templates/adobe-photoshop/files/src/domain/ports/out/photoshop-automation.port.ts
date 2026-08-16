import type { Result } from "../../../shared/result";
import type { CreativeServiceError } from "../../errors/creative-service-error";

/**
 * Outbound port for the Adobe Photoshop API (image.adobe.io/pie/psdService).
 *
 * Each operation edits a pre-authored `.psd` whose layers are addressed **by
 * name** (Smart Objects / text layers), then writes the result. Async under the
 * hood; every method resolves to the output href. Hrefs are presigned URLs
 * (`storage: "external"`).
 */
export interface PsdRequest {
  /** Presigned input `.psd` href. */
  readonly inputHref: string;
  /** Presigned destination the result is written to. */
  readonly outputHref: string;
}

export interface SmartObjectRequest extends PsdRequest {
  /** Name of the Smart Object layer to replace. */
  readonly layerName: string;
  /** Presigned href of the replacement image. */
  readonly replacementHref: string;
}

export interface EditTextLayerRequest extends PsdRequest {
  /** Name of the text layer to edit. */
  readonly layerName: string;
  /** New text content. */
  readonly text: string;
}

export interface ApplyActionJsonRequest extends PsdRequest {
  /** Photoshop actionJSON to apply (verbatim payload). */
  readonly actions: unknown;
}

export interface CropRequest extends PsdRequest {
  readonly bounds: { left: number; top: number; right: number; bottom: number };
}

export interface RenderPsdRequest extends PsdRequest {
  /** Output format; defaults to the install-configured format. */
  readonly format?: "jpeg" | "png";
}

export interface PhotoshopAutomationPort {
  /** Replace a named Smart Object layer with another image. */
  smartObject(req: SmartObjectRequest): Promise<Result<string, CreativeServiceError>>;
  /** Edit the contents of a named text layer. */
  editTextLayer(req: EditTextLayerRequest): Promise<Result<string, CreativeServiceError>>;
  /** Apply a Photoshop actionJSON to the document. */
  applyActionJson(req: ApplyActionJsonRequest): Promise<Result<string, CreativeServiceError>>;
  /** Crop the document to the given bounds. */
  crop(req: CropRequest): Promise<Result<string, CreativeServiceError>>;
  /** Render the `.psd` to a flattened image. */
  renderPsd(req: RenderPsdRequest): Promise<Result<string, CreativeServiceError>>;
}
