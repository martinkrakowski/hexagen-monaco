import type { Result } from "../../../shared/result";
// Type-only import of the infrastructure error (erased at compile) — the deliberate
// domain→infra decoupling for the port's failure channel, not an oversight.
import type { FireflyError } from "../../../infrastructure/adobe/errors/firefly-errors";

/**
 * Outbound port for the Adobe Creative Production API (batch automation).
 *
 * Maps a single published workflow over N assets in one async batch job and
 * surfaces per-asset status: a failed asset is reported in-band (status
 * "failed") rather than failing the whole batch. Resolves to one result per
 * asset, in request order. Hrefs are presigned URLs (`storage: "external"`).
 */
export interface CreativeProductionAsset {
  /** Caller-supplied id, echoed back in the result for correlation. */
  readonly id: string;
  /** Presigned input asset the workflow runs over. */
  readonly inputHref: string;
  /** Presigned destination this asset's output is written to. */
  readonly outputHref: string;
}

export interface RunWorkflowRequest {
  /** Published Creative Production workflow the batch runs. */
  readonly workflowId: string;
  /** Assets the workflow is mapped over; processed in one async batch job. */
  readonly assets: readonly CreativeProductionAsset[];
}

/**
 * Per-asset outcome — a discriminated union on `status` so the contract is
 * compile-time enforced: a succeeded asset always carries `outputHref`, a failed
 * asset always carries `error`. Callers narrow on `status` rather than guarding
 * optional fields at runtime.
 */
export type AssetResult =
  | {
      /** Echoes the request asset id. */
      readonly id: string;
      readonly status: "succeeded";
      /** Presigned output href the workflow wrote for this asset. */
      readonly outputHref: string;
    }
  | {
      /** Echoes the request asset id. */
      readonly id: string;
      readonly status: "failed";
      /** Failure detail. */
      readonly error: string;
    };

export interface CreativeProductionPort {
  /**
   * Run a published workflow over a batch of assets. Resolves to one result per
   * asset, in the same order as `req.assets`, each carrying its own status —
   * partial success is surfaced rather than failing the whole batch. The outer
   * Result fails only on a batch-level error (submit / poll / count mismatch).
   */
  runWorkflow(
    req: RunWorkflowRequest,
  ): Promise<Result<AssetResult[], FireflyError>>;
}
