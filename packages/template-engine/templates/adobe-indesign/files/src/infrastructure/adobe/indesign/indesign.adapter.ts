// @hexagen-server-only
import type {
  DataMergeRequest,
  ExportPdfRequest,
  InDesignFormat,
  InDesignPort,
  RenderLayoutRequest,
} from "../../../domain/ports/out/indesign.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Adobe InDesign adapter — the AWS-of-Adobe↔domain boundary for {@link InDesignPort}.
 *
 * Enabled operations (install): {operations}. The InDesign API lives on
 * image.adobe.io (same host family as Photoshop/Lightroom/Illustrator — a
 * different host than firefly-api.adobe.io), so the adapter posts ABSOLUTE URLs;
 * the shared `fireflyClient` passes those through with the same IMS auth. Each
 * call presigns its IO, submits the async job, and awaits the result.
 *
 * NOTE: paths/payloads version frequently — verify against Adobe docs.
 */
const INDESIGN_BASE = normalizeBase(
  process.env.ADOBE_INDESIGN_BASE_URL?.trim() || "https://image.adobe.io",
);

// Strictly validate the env value rather than blind-casting — an invalid value
// would otherwise reach the API. Fall back to the (always-valid) install default.
const rawDefaultFormat = process.env.ADOBE_INDESIGN_FORMAT?.trim();
const DEFAULT_FORMAT: InDesignFormat =
  rawDefaultFormat === "pdf" || rawDefaultFormat === "jpg" || rawDefaultFormat === "png"
    ? rawDefaultFormat
    : "{output_format}";

export class InDesignAdapter implements InDesignPort {
  async dataMerge(req: DataMergeRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const data = await storage.presignInput(req.dataHref);
      const output = await storage.presignOutput(req.outputHref);
      return {
        path: endpoint("dataMerge"),
        body: {
          inputs: [external(input.href)],
          options: { dataSource: external(data.href) },
          outputs: [outputSpec(output.href, req.format ?? DEFAULT_FORMAT)],
        },
      };
    });
  }

  async renderLayout(req: RenderLayoutRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("renderLayout"),
        body: {
          inputs: [external(input)],
          outputs: [outputSpec(output, req.format ?? DEFAULT_FORMAT)],
        },
      };
    });
  }

  async exportPdf(req: ExportPdfRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("exportPdf"),
        // exportPdf always produces a PDF, regardless of the default format.
        body: {
          inputs: [external(input)],
          outputs: [outputSpec(output, "pdf")],
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
      // image.adobe.io services are tracked by a status URL (_links.self.href) and
      // are polled regardless of the project's job_mode (they don't deliver Firefly
      // webhooks). A response without a status URL can't be polled, so surface a
      // clear error rather than routing through the job port's await — which only
      // resolves a jobId-only handle in webhook mode and would fail in polling builds.
      if (!handle.statusUrl) {
        return err(new FireflyError("InDesign submit response had no status URL to track the job."));
      }
      // jobPort.poll() is the centralised always-poll entry point (keeps the wait
      // path on the port rather than importing the poller directly).
      const done = await jobPort.poll(handle);
      if (done.status !== "succeeded") {
        return err(new FireflyError(done.error ?? "InDesign job did not succeed."));
      }
      // `done.outputs` is a non-optional JobOutput[] (parseJobResult always returns
      // an array), so `[0]?.href` is enough — an empty array yields the no-output
      // path below; no `?.` on `outputs` itself is needed.
      const href = done.outputs[0]?.href;
      if (!href) {
        return err(new FireflyError("InDesign job produced no output."));
      }
      return ok(href);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }
}

function endpoint(operation: string): string {
  return `${INDESIGN_BASE}/idService/${operation}`;
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

function outputSpec(
  href: string,
  format: InDesignFormat,
): { href: string; storage: "external"; type: string } {
  const type =
    format === "pdf" ? "application/pdf" : format === "jpg" ? "image/jpeg" : "image/png";
  return { ...external(href), type };
}

/**
 * Guarantee an absolute, scheme-qualified base with no trailing slash, and lowercase
 * the scheme. fireflyClient now matches schemes case-insensitively, but keeping the
 * emitted URL lowercase is defensive and consistent with the other image.adobe.io
 * adapters (Photoshop/Lightroom/Illustrator). A schemeless `image.adobe.io` would
 * otherwise be mis-prefixed with the Firefly base URL.
 */
function normalizeBase(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase())
    : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/** Shared singleton. */
export const indesign = new InDesignAdapter();
