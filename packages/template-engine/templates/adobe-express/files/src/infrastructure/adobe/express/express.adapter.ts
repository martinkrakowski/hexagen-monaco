// @hexagen-server-only
import type {
  ExpressAutomationPort,
  ExpressFormat,
  RenderBatchRequest,
} from "../../../domain/ports/out/express.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { toCreativeServiceError } from "../errors/to-creative-service-error";
import { CreativeServiceError } from "../../../domain/errors/creative-service-error";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Adobe Express adapter — the Express-batch↔domain boundary for
 * {@link ExpressAutomationPort}.
 *
 * Enabled at install with output format {output_format}. The Express batch API
 * lives on the image.adobe.io host family (same as Photoshop/Lightroom/
 * Illustrator/InDesign — a different host than firefly-api.adobe.io), so the
 * adapter posts ABSOLUTE URLs; the shared `fireflyClient` passes those through
 * with the same IMS auth. One submit renders every variant in a single async
 * batch job, and the result carries one output per variant.
 *
 * NOTE: host/paths/payloads version frequently — verify against Adobe docs.
 */
const EXPRESS_BASE = normalizeBase(
  process.env.ADOBE_EXPRESS_BASE_URL?.trim() || "https://image.adobe.io",
);

// Strictly validate the env value rather than blind-casting — an invalid value
// would otherwise reach the API. Fall back to the (always-valid) install default.
const rawDefaultFormat = process.env.ADOBE_EXPRESS_FORMAT?.trim();
const DEFAULT_FORMAT: ExpressFormat =
  rawDefaultFormat === "jpg" || rawDefaultFormat === "png" || rawDefaultFormat === "pdf"
    ? rawDefaultFormat
    : "{output_format}";

export class ExpressAdapter implements ExpressAutomationPort {
  async renderBatch(
    req: RenderBatchRequest,
  ): Promise<Result<string[], CreativeServiceError>> {
    // A batch with no variants would submit an empty job the API rejects — guard
    // up front rather than spending a round-trip to discover it. This is
    // batch-specific; the single-output image.adobe.io services can't hit it.
    if (req.items.length === 0) {
      return err(new CreativeServiceError("unknown", "renderBatch requires at least one variant."));
    }
    try {
      // Presign every variant's destination up front. An asset-valued
      // modification is already a presigned input href supplied by the caller,
      // so it passes through untouched.
      const storage = getStoragePresigner();
      const outputs = await Promise.all(
        req.items.map(async (item) => {
          const output = await storage.presignOutput(item.outputHref);
          return {
            modifications: item.modifications.map((m) => ({
              key: m.key,
              value: m.value,
            })),
            destination: outputSpec(output.href, item.format ?? DEFAULT_FORMAT),
          };
        }),
      );

      const handle = toJobHandle(
        await fireflyClient.post(endpoint("batch"), {
          templateId: req.templateId,
          outputs,
        }),
      );
      // image.adobe.io services are tracked by a status URL (_links.self.href) and
      // are polled regardless of the project's job_mode (they don't deliver Firefly
      // webhooks). A response without a status URL can't be polled, so surface a
      // clear error rather than routing through the job port's await — which only
      // resolves a jobId-only handle in webhook mode and would fail in polling builds.
      if (!handle.statusUrl) {
        return err(
          new CreativeServiceError("unknown", 
            "Express batch submit response had no status URL to track the job.",
          ),
        );
      }
      // jobPort.poll() is the centralised always-poll entry point (keeps the wait
      // path on the port rather than importing the poller directly).
      const done = await jobPort.poll(handle);
      if (done.status !== "succeeded") {
        return err(
          new CreativeServiceError("unknown", done.error ?? "Express batch job did not succeed."),
        );
      }
      // The port promises one href per item, in request order. `done.outputs` is a
      // non-optional JobOutput[] (parseJobResult always returns an array), but an
      // entry can carry inline `data` instead of an `href`, so VALIDATE the 1:1
      // alignment rather than filtering — silently dropping an hrefless entry would
      // return a shorter array that no longer lines up with req.items.
      if (done.outputs.length !== req.items.length) {
        return err(
          new CreativeServiceError("unknown", 
            `Express batch returned ${done.outputs.length} outputs for ${req.items.length} items.`,
          ),
        );
      }
      const hrefs: string[] = [];
      for (let i = 0; i < done.outputs.length; i++) {
        const href = done.outputs[i]?.href;
        if (!href) {
          return err(
            new CreativeServiceError("unknown", `Express batch output ${i} has no href.`),
          );
        }
        hrefs.push(href);
      }
      return ok(hrefs);
    } catch (error) {
      return err(toCreativeServiceError(error));
    }
  }
}

function endpoint(operation: string): string {
  return `${EXPRESS_BASE}/express/${operation}`;
}

function outputSpec(
  href: string,
  format: ExpressFormat,
): { href: string; storage: "external"; type: string } {
  const type =
    format === "pdf"
      ? "application/pdf"
      : format === "png"
        ? "image/png"
        : "image/jpeg";
  return { href, storage: "external", type };
}

/**
 * Guarantee an absolute, scheme-qualified base with no trailing slash, and lowercase
 * the scheme. fireflyClient now matches schemes case-insensitively, but keeping the
 * emitted URL lowercase is defensive and consistent with the other image.adobe.io
 * adapters (Photoshop/Lightroom/Illustrator/InDesign). A schemeless `image.adobe.io`
 * would otherwise be mis-prefixed with the Firefly base URL.
 */
function normalizeBase(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase())
    : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

// Shared singleton. Named `expressAutomation` (not `express`) to avoid colliding
// with the Express.js `express` import a generated web project commonly has.
export const expressAutomation = new ExpressAdapter();
