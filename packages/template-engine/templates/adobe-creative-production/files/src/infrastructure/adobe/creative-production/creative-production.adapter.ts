// @hexagen-server-only
import type {
  AssetResult,
  CreativeProductionPort,
  RunWorkflowRequest,
} from "../../../domain/ports/out/creative-production.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Adobe Creative Production adapter — the workflow-batch↔domain boundary for
 * {@link CreativeProductionPort}.
 *
 * Maps a published workflow over a batch of assets in one async job on the
 * image.adobe.io host family (same as Photoshop/Lightroom/Illustrator/InDesign/
 * Express — a different host than firefly-api.adobe.io), so the adapter posts
 * ABSOLUTE URLs; the shared `fireflyClient` passes those through with the same
 * IMS auth. The result carries one entry per asset, aligned to request order,
 * each with its own status — a failed asset is reported in-band.
 *
 * NOTE: host/paths/payloads version frequently — verify against Adobe docs.
 */
const CREATIVE_PRODUCTION_BASE = normalizeBase(
  process.env.ADOBE_CREATIVE_PRODUCTION_BASE_URL?.trim() ||
    "https://image.adobe.io",
);

export class CreativeProductionAdapter implements CreativeProductionPort {
  async runWorkflow(
    req: RunWorkflowRequest,
  ): Promise<Result<AssetResult[], FireflyError>> {
    // A batch with no assets would submit an empty job the API rejects — guard
    // up front rather than spending a round-trip to discover it.
    if (req.assets.length === 0) {
      return err(new FireflyError("runWorkflow requires at least one asset."));
    }
    try {
      // Presign each asset's input + output up front; the workflow runs over the
      // presigned inputs and writes to the presigned destinations.
      const storage = getStoragePresigner();
      const assets = await Promise.all(
        req.assets.map(async (asset) => {
          const input = await storage.presignInput(asset.inputHref);
          const output = await storage.presignOutput(asset.outputHref);
          return {
            id: asset.id,
            input: external(input.href),
            output: external(output.href),
          };
        }),
      );

      const handle = toJobHandle(
        await fireflyClient.post(endpoint("run"), {
          workflowId: req.workflowId,
          assets,
        }),
      );
      // image.adobe.io services are tracked by a status URL (_links.self.href) and
      // are polled regardless of the project's job_mode (they don't deliver Firefly
      // webhooks). A response without a status URL can't be polled, so surface a
      // clear error rather than routing through the job port's await — which only
      // resolves a jobId-only handle in webhook mode and would fail in polling builds.
      if (!handle.statusUrl) {
        return err(
          new FireflyError(
            "Creative Production submit response had no status URL to track the job.",
          ),
        );
      }
      // jobPort.poll() is the centralised always-poll entry point (keeps the wait
      // path on the port rather than importing the poller directly).
      const done = await jobPort.poll(handle);
      if (done.status !== "succeeded") {
        return err(
          new FireflyError(
            done.error ?? "Creative Production job did not succeed.",
          ),
        );
      }
      // Align outputs 1:1 with the requested assets so every entry maps to its
      // request id in order. Alignment is POSITIONAL by necessity: the shared
      // JobOutput is {href?, data?} with no id, so there is nothing to correlate
      // on — the batch API is relied upon to return outputs in submission order
      // (the count-mismatch guard below is the integrity check). A length
      // mismatch is a batch-level failure (results can't be correlated to
      // assets); a per-asset missing href is reported IN-BAND as a "failed"
      // asset, not a whole-batch error — the partial-success contract this
      // service exists to provide.
      if (done.outputs.length !== req.assets.length) {
        return err(
          new FireflyError(
            `Creative Production returned ${done.outputs.length} outputs for ${req.assets.length} assets.`,
          ),
        );
      }
      const results: AssetResult[] = req.assets.map((asset, i) => {
        const href = done.outputs[i]?.href;
        return href
          ? { id: asset.id, status: "succeeded", outputHref: href }
          : {
              id: asset.id,
              status: "failed",
              error: "Workflow produced no output for this asset.",
            };
      });
      return ok(results);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }
}

function endpoint(operation: string): string {
  return `${CREATIVE_PRODUCTION_BASE}/creative-production/${operation}`;
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

/**
 * Guarantee an absolute, scheme-qualified base with no trailing slash, and lowercase
 * the scheme. fireflyClient now matches schemes case-insensitively, but keeping the
 * emitted URL lowercase is defensive and consistent with the other image.adobe.io
 * adapters (Photoshop/Lightroom/Illustrator/InDesign/Express). A schemeless
 * `image.adobe.io` would otherwise be mis-prefixed with the Firefly base URL.
 */
function normalizeBase(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase())
    : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/** Shared singleton. */
export const creativeProduction = new CreativeProductionAdapter();
