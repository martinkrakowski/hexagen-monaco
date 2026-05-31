import type { Result } from "../../../shared/result";
// Type-only import of the infrastructure error (erased at compile) — the accepted
// pattern for typing a port's failure channel without runtime domain→infra coupling.
import type { FireflyError } from "../../../infrastructure/adobe/errors/firefly-errors";

/**
 * Outbound port for the Firefly Upscale service.
 *
 * Async under the hood (submit → await job), but the port presents a single
 * `Result`-returning call. Hrefs are presigned URLs (`storage: "external"`):
 * supply them yourself (core passthrough) or let a storage addon presign them.
 */
export interface UpscaleRequest {
  /** Source image the service reads (presigned GET href). */
  readonly inputHref: string;
  /** Destination the upscaled image is written to (presigned PUT href). */
  readonly outputHref: string;
  /** Upscale factor; falls back to the install-configured default. */
  readonly factor?: number;
}

export interface UpscalePort {
  /** Upscale `inputHref` into `outputHref`; resolves to the output href on success. */
  upscale(req: UpscaleRequest): Promise<Result<string, FireflyError>>;
}
