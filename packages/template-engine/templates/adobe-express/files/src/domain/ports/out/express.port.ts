import type { Result } from "../../../shared/result";
// Type-only import of the infrastructure error (erased at compile) — the deliberate
// domain→infra decoupling for the port's failure channel, not an oversight.
import type { FireflyError } from "../../../infrastructure/adobe/errors/firefly-errors";

/**
 * Outbound port for the Adobe Express API (batch automation).
 *
 * Renders many variants from a single published Express template in one async
 * batch job — the localization use case: one variant per locale/region with
 * translated copy and regional imagery. Resolves to one output href per item,
 * in request order. Hrefs are presigned URLs (`storage: "external"`).
 */
export type ExpressFormat = "jpg" | "png" | "pdf";

/** A single named substitution applied to the published template. */
export interface ExpressModification {
  /** Named field/layer/asset in the template (e.g. `headline`, `hero`). */
  readonly key: string;
  /** Replacement: literal text, or a presigned asset href for image fields. */
  readonly value: string;
}

/** One rendered variant: its modifications plus where the result is written. */
export interface ExpressRenderItem {
  /** Per-variant substitutions (e.g. one locale's translated copy + imagery). */
  readonly modifications: readonly ExpressModification[];
  /** Presigned destination this variant is written to. */
  readonly outputHref: string;
  /** Output format for this variant; defaults to the install-configured format. */
  readonly format?: ExpressFormat;
}

export interface RenderBatchRequest {
  /** Published Express template the batch renders from. */
  readonly templateId: string;
  /** One entry per output variant; rendered in a single async batch job. */
  readonly items: readonly ExpressRenderItem[];
}

export interface ExpressAutomationPort {
  /**
   * Render a batch of variants from a published Express template. Resolves to
   * one output href per item, in the same order as `req.items`.
   */
  renderBatch(req: RenderBatchRequest): Promise<Result<string[], FireflyError>>;
}
