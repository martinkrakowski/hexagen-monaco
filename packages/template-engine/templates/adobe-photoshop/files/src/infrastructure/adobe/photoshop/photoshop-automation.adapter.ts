// @hexagen-server-only
import type {
  ApplyActionJsonRequest,
  CropRequest,
  EditTextLayerRequest,
  PhotoshopAutomationPort,
  RenderPsdRequest,
  SmartObjectRequest,
} from "../../../domain/ports/out/photoshop-automation.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { pollJobStatus } from "../jobs/job-poller";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Adobe Photoshop adapter — the AWS-of-Adobe↔domain boundary for
 * {@link PhotoshopAutomationPort}.
 *
 * Enabled operations (install): {operations}. The Photoshop API lives on
 * image.adobe.io (a different host than firefly-api.adobe.io), so the adapter
 * posts ABSOLUTE URLs — the shared `fireflyClient` passes those through with the
 * same IMS auth. Each call presigns its IO, submits the async job, awaits via
 * `FireflyJobPort`, and returns the output href.
 *
 * NOTE: paths/payloads version frequently — verify against Adobe docs.
 */
const PHOTOSHOP_BASE = normalizeBase(process.env.ADOBE_PHOTOSHOP_BASE_URL?.trim() || "https://image.adobe.io");

/**
 * Guarantee an absolute, scheme-qualified base with no trailing slash. fireflyClient
 * only treats `http(s)://…` as absolute, so a schemeless `image.adobe.io` would be
 * mis-prefixed with the Firefly base URL and break every Photoshop request.
 */
function normalizeBase(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}
const DEFAULT_FORMAT = (process.env.ADOBE_PHOTOSHOP_FORMAT?.trim() || "{output_format}") as
  | "jpeg"
  | "png";

const PSD_TYPE = "image/vnd.adobe.photoshop";

export class PhotoshopAutomationAdapter implements PhotoshopAutomationPort {
  async smartObject(req: SmartObjectRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const replacement = await storage.presignInput(req.replacementHref);
      const output = await storage.presignOutput(req.outputHref);
      return {
        path: endpoint("smartObject"),
        body: {
          inputs: [external(input.href)],
          options: {
            layers: [{ name: req.layerName, input: external(replacement.href) }],
          },
          outputs: [{ ...external(output.href), type: PSD_TYPE }],
        },
      };
    });
  }

  async editTextLayer(req: EditTextLayerRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("text"),
        body: {
          inputs: [external(input)],
          options: {
            layers: [{ name: req.layerName, text: { content: req.text } }],
          },
          outputs: [{ ...external(output), type: PSD_TYPE }],
        },
      };
    });
  }

  async applyActionJson(req: ApplyActionJsonRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("actionJSON"),
        body: {
          inputs: [external(input)],
          options: { actionJSON: req.actions },
          outputs: [{ ...external(output), type: PSD_TYPE }],
        },
      };
    });
  }

  async crop(req: CropRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("crop"),
        body: {
          inputs: [external(input)],
          options: { bounds: req.bounds },
          outputs: [{ ...external(output), type: PSD_TYPE }],
        },
      };
    });
  }

  async renderPsd(req: RenderPsdRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      const format = req.format ?? DEFAULT_FORMAT;
      return {
        path: endpoint("renditionCreate"),
        body: {
          inputs: [external(input)],
          outputs: [{ ...external(output), type: format === "png" ? "image/png" : "image/jpeg" }],
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
      // The Photoshop API tracks jobs by a status URL (_links.self.href) and may
      // omit a job id — accept either; only neither is an error.
      if (!handle.jobId && !handle.statusUrl) {
        return err(new FireflyError("Photoshop submit response did not include a job handle."));
      }
      // Poll the status URL directly when present: that is Photoshop's native
      // tracking, and it works in BOTH polling and webhook deployments. Using
      // jobPort.await() here would reject a status-URL-only job in webhook mode
      // (it requires a job id to correlate the callback). Fall back to await()
      // only for a jobId-only handle.
      const done = handle.statusUrl
        ? await pollJobStatus(handle)
        : await jobPort.await(handle);
      if (done.status !== "succeeded") {
        return err(new FireflyError(done.error ?? "Photoshop job did not succeed."));
      }
      const href = done.outputs[0]?.href;
      if (!href) {
        return err(new FireflyError("Photoshop job produced no output."));
      }
      return ok(href);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }
}

function endpoint(operation: string): string {
  return `${PHOTOSHOP_BASE}/pie/psdService/${operation}`;
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

/** Shared singleton. */
export const photoshopAutomation = new PhotoshopAutomationAdapter();
