import type { Result } from "../../../shared/result";
// Type-only import of the infrastructure error (erased at compile) — types the
// port's failure channel without runtime domain→infra coupling.
import type { FireflyError } from "../../../infrastructure/adobe/errors/firefly-errors";

/**
 * Outbound port for the Firefly Content Tagging service.
 *
 * Unlike the image services, the result is **JSON, not an asset** — structured
 * tags/metadata for an input image, useful for search and personalization. The
 * input is a presigned href; no output storage is needed.
 */
export interface ContentTag {
  readonly name: string;
  /** Provider confidence in [0,1], when supplied. */
  readonly confidence?: number;
}

export interface ContentTaggingResult {
  readonly tags: ContentTag[];
  /** Raw provider payload, for callers needing more than the flattened tags. */
  readonly raw?: unknown;
}

export interface ContentTaggingPort {
  /** Return structured tags for the image at `inputHref` (presigned). */
  tag(inputHref: string): Promise<Result<ContentTaggingResult, FireflyError>>;
}
