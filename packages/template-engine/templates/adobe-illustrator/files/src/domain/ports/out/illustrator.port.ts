import type { Result } from "../../../shared/result";
// Type-only import of the infrastructure error (erased at compile) — the deliberate
// domain→infra decoupling for the port's failure channel, not an oversight.
import type { FireflyError } from "../../../infrastructure/adobe/errors/firefly-errors";

/**
 * Outbound port for the Adobe Illustrator API (image.adobe.io).
 *
 * Vector automation: render an artboard, merge variable data into a template, or
 * scale a vector to an arbitrary size (vector→raster, ads → billboards). Async
 * under the hood; every method resolves to the output href. Hrefs are presigned
 * URLs (`storage: "external"`).
 */
export type IllustratorFormat = "png" | "jpeg" | "pdf";

export interface IllustratorRequest {
  /** Presigned input `.ai` href. */
  readonly inputHref: string;
  /** Presigned destination the result is written to. */
  readonly outputHref: string;
  /** Output format; defaults to the install-configured format. */
  readonly format?: IllustratorFormat;
}

export interface RenderArtboardRequest extends IllustratorRequest {
  /** Artboard index or name to render (default: the active artboard). */
  readonly artboard?: number | string;
  /** Scale factor applied to the artboard. */
  readonly scale?: number;
}

export interface DataMergeRequest extends IllustratorRequest {
  /** Variable data merged into the template's named fields. */
  readonly data: Record<string, unknown>;
}

export interface ScaleVectorRequest extends IllustratorRequest {
  /** Uniform scale factor (use this OR width/height). */
  readonly scale?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface IllustratorPort {
  /** Render an artboard to a raster/PDF at a given scale. */
  renderArtboard(req: RenderArtboardRequest): Promise<Result<string, FireflyError>>;
  /** Merge variable data into a template document. */
  dataMerge(req: DataMergeRequest): Promise<Result<string, FireflyError>>;
  /** Scale a vector to an arbitrary size and rasterise. */
  scaleVector(req: ScaleVectorRequest): Promise<Result<string, FireflyError>>;
}
