// @hexagen-server-only
import type {
  DataMergeRequest,
  IllustratorFormat,
  IllustratorPort,
  RenderArtboardRequest,
  ScaleVectorRequest,
} from "../../../domain/ports/out/illustrator.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { pollJobStatus } from "../jobs/job-poller";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import {
  classifyAdobeError,
  FireflyError,
  FireflyValidationError,
} from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Adobe Illustrator adapter — the AWS-of-Adobe↔domain boundary for {@link IllustratorPort}.
 *
 * Enabled operations (install): {operations}. The Illustrator API lives on
 * image.adobe.io (same host family as Photoshop/Lightroom — a different host than
 * firefly-api.adobe.io), so the adapter posts ABSOLUTE URLs; the shared
 * `fireflyClient` passes those through with the same IMS auth. Each call presigns
 * its IO, submits the async job, awaits the result, and returns the output href.
 *
 * NOTE: paths/payloads version frequently — verify against Adobe docs.
 */
const ILLUSTRATOR_BASE = normalizeBase(
  process.env.ADOBE_ILLUSTRATOR_BASE_URL?.trim() || "https://image.adobe.io",
);

// Strictly validate the env value rather than blind-casting — an invalid value
// would otherwise reach the API. Fall back to the (always-valid) install default.
const rawDefaultFormat = process.env.ADOBE_ILLUSTRATOR_FORMAT?.trim();
const DEFAULT_FORMAT: IllustratorFormat =
  rawDefaultFormat === "png" || rawDefaultFormat === "jpeg" || rawDefaultFormat === "pdf"
    ? rawDefaultFormat
    : "{output_format}";

export class IllustratorAdapter implements IllustratorPort {
  async renderArtboard(req: RenderArtboardRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("renderArtboard"),
        body: {
          inputs: [external(input)],
          options: { artboard: req.artboard, scale: req.scale },
          outputs: [outputSpec(output, req.format ?? DEFAULT_FORMAT)],
        },
      };
    });
  }

  async dataMerge(req: DataMergeRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("dataMerge"),
        body: {
          inputs: [external(input)],
          options: { data: req.data },
          outputs: [outputSpec(output, req.format ?? DEFAULT_FORMAT)],
        },
      };
    });
  }

  async scaleVector(req: ScaleVectorRequest): Promise<Result<string, FireflyError>> {
    // Fail fast on an empty target: the API rejects scaling with no dimensions,
    // so surface a clear validation error rather than a downstream 400.
    if (req.scale === undefined && req.width === undefined && req.height === undefined) {
      return err(
        new FireflyValidationError("scaleVector requires at least one of scale, width, or height."),
      );
    }
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("scaleVector"),
        body: {
          inputs: [external(input)],
          options: { scale: req.scale, width: req.width, height: req.height },
          outputs: [outputSpec(output, req.format ?? DEFAULT_FORMAT)],
        },
      };
    });
  }

  private async presignIO(req: {
    inputHref: string;
    outputHref: string;
  }): Promise<{ input: string; output: string }> {
    const storage = getStoragePresigner();
    const input = await storage.presignInput(req.inputHref);
    const output = await storage.presignOutput(req.outputHref);
    return { input: input.href, output: output.href };
  }

  private async run(
    build: () => Promise<{ path: string; body: unknown }>,
  ): Promise<Result<string, FireflyError>> {
    try {
      const { path, body } = await build();
      const handle = toJobHandle(await fireflyClient.post(path, body));
      // image.adobe.io services track jobs by a status URL (_links.self.href) and
      // may omit a job id — accept either; only neither is an error.
      if (!handle.jobId && !handle.statusUrl) {
        return err(new FireflyError("Illustrator submit response did not include a job handle."));
      }
      // Poll the status URL directly when present: that is the native tracking and
      // works in BOTH polling and webhook deployments. jobPort.await() would reject
      // a status-URL-only job in webhook mode (it needs a job id to correlate the
      // callback). Fall back to await() only for a jobId-only handle.
      const done = handle.statusUrl
        ? await pollJobStatus(handle)
        : await jobPort.await(handle);
      if (done.status !== "succeeded") {
        return err(new FireflyError(done.error ?? "Illustrator job did not succeed."));
      }
      // `done.outputs` is a non-optional JobOutput[] (parseJobResult always returns
      // an array), so `[0]?.href` is enough — an empty array yields the no-output
      // path below; no `?.` on `outputs` itself is needed.
      const href = done.outputs[0]?.href;
      if (!href) {
        return err(new FireflyError("Illustrator job produced no output."));
      }
      return ok(href);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }
}

function endpoint(operation: string): string {
  return `${ILLUSTRATOR_BASE}/aiService/${operation}`;
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

function outputSpec(
  href: string,
  format: IllustratorFormat,
): { href: string; storage: "external"; type: string } {
  const type =
    format === "pdf" ? "application/pdf" : format === "jpeg" ? "image/jpeg" : "image/png";
  return { ...external(href), type };
}

/**
 * Guarantee an absolute, scheme-qualified base with no trailing slash, and lowercase
 * the scheme. fireflyClient now matches schemes case-insensitively, but keeping the
 * emitted URL lowercase is defensive and consistent with the other image.adobe.io
 * adapters (Photoshop/Lightroom). A schemeless `image.adobe.io` would otherwise be
 * mis-prefixed with the Firefly base URL.
 */
function normalizeBase(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase())
    : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/** Shared singleton. */
export const illustrator = new IllustratorAdapter();
