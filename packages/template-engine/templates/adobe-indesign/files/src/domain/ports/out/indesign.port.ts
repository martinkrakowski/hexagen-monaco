import type { Result } from "../../../shared/result";
// Type-only import of the infrastructure error (erased at compile) — the deliberate
// domain→infra decoupling for the port's failure channel, not an oversight.
import type { FireflyError } from "../../../infrastructure/adobe/errors/firefly-errors";

/**
 * Outbound port for the Adobe InDesign API (image.adobe.io).
 *
 * Template-driven document automation: merge a data source into a published
 * template, render a layout, or export to PDF. Async under the hood; every method
 * resolves to the output href. Hrefs are presigned URLs (`storage: "external"`).
 */
export type InDesignFormat = "pdf" | "jpg" | "png";

export interface InDesignRequest {
  /** Presigned input template (`.indd`) href. */
  readonly inputHref: string;
  /** Presigned destination the result is written to. */
  readonly outputHref: string;
}

export interface DataMergeRequest extends InDesignRequest {
  /** Presigned data source (CSV/JSON) merged into the template. */
  readonly dataHref: string;
  /** Output format; defaults to the install-configured format. */
  readonly format?: InDesignFormat;
}

export interface RenderLayoutRequest extends InDesignRequest {
  /** Output format; defaults to the install-configured format. */
  readonly format?: InDesignFormat;
}

export type ExportPdfRequest = InDesignRequest;

export interface InDesignPort {
  /** Merge a data source into a template, producing one document per record set. */
  dataMerge(req: DataMergeRequest): Promise<Result<string, FireflyError>>;
  /** Render a template's layout to an image/PDF. */
  renderLayout(req: RenderLayoutRequest): Promise<Result<string, FireflyError>>;
  /** Export a template to PDF. */
  exportPdf(req: ExportPdfRequest): Promise<Result<string, FireflyError>>;
}
