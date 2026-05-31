// @hexagen-server-only
import type {
  ApplyPresetRequest,
  EditRequest,
  LightroomPort,
  LightroomRequest,
} from "../../../domain/ports/out/lightroom.port";
import { fireflyClient } from "../http/firefly-client";
import { pollJobStatus } from "../jobs/job-poller";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Adobe Lightroom adapter — the AWS-of-Adobe↔domain boundary for {@link LightroomPort}.
 *
 * Enabled operations (install): {operations}. The Lightroom API lives on
 * image.adobe.io (same host as Photoshop, `/lrService` path — a different host
 * than firefly-api.adobe.io), so the adapter posts ABSOLUTE URLs; the shared
 * `fireflyClient` passes those through with the same IMS auth. Each call presigns
 * its IO, submits the async job, awaits the result, and returns the output href.
 *
 * NOTE: paths/payloads version frequently — verify against Adobe docs.
 */
const LIGHTROOM_BASE = normalizeBase(
  process.env.ADOBE_LIGHTROOM_BASE_URL?.trim() || "https://image.adobe.io",
);

// Strictly validate the env value rather than blind-casting — an invalid value
// would otherwise fall through to the JPEG branch. Fall back to the install default.
const rawDefaultFormat = process.env.ADOBE_LIGHTROOM_FORMAT?.trim();
const DEFAULT_FORMAT: "jpeg" | "png" =
  rawDefaultFormat === "jpeg" || rawDefaultFormat === "png" ? rawDefaultFormat : "{output_format}";

export class LightroomAdapter implements LightroomPort {
  async autoTone(req: LightroomRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("autoTone"),
        body: { inputs: [external(input)], outputs: [outputSpec(output)] },
      };
    });
  }

  async applyPreset(req: ApplyPresetRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const preset = await storage.presignInput(req.presetHref);
      const output = await storage.presignOutput(req.outputHref);
      return {
        path: endpoint("presets"),
        body: {
          inputs: [external(input.href)],
          options: { presets: [external(preset.href)] },
          outputs: [outputSpec(output.href)],
        },
      };
    });
  }

  async edit(req: EditRequest): Promise<Result<string, FireflyError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("edit"),
        body: {
          inputs: [external(input)],
          options: { xmp: req.edits },
          outputs: [outputSpec(output)],
        },
      };
    });
  }

  private async presignIO(req: LightroomRequest): Promise<{ input: string; output: string }> {
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
      // Lightroom is tracked by a status URL (_links.self.href) and is polled
      // regardless of the project's job_mode (it doesn't deliver Firefly webhooks).
      // A response without a status URL can't be polled, so surface a clear error
      // rather than routing through the job port's await — which only resolves a
      // jobId-only handle in webhook mode and would fail in polling builds.
      if (!handle.statusUrl) {
        return err(new FireflyError("Lightroom submit response had no status URL to track the job."));
      }
      const done = await pollJobStatus(handle);
      if (done.status !== "succeeded") {
        return err(new FireflyError(done.error ?? "Lightroom job did not succeed."));
      }
      // `done.outputs` is a non-optional JobOutput[] (parseJobResult always returns
      // an array), so `[0]?.href` is enough — an empty array yields the no-output
      // path below; no `?.` on `outputs` itself is needed.
      const href = done.outputs[0]?.href;
      if (!href) {
        return err(new FireflyError("Lightroom job produced no output."));
      }
      return ok(href);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }
}

function endpoint(operation: string): string {
  return `${LIGHTROOM_BASE}/lrService/${operation}`;
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

function outputSpec(href: string): { href: string; storage: "external"; type: string } {
  return { ...external(href), type: DEFAULT_FORMAT === "png" ? "image/png" : "image/jpeg" };
}

/**
 * Guarantee an absolute, scheme-qualified base with no trailing slash. fireflyClient
 * only treats `http(s)://…` as absolute, so a schemeless `image.adobe.io` would be
 * mis-prefixed with the Firefly base URL and break every Lightroom request.
 */
function normalizeBase(raw: string): string {
  // Lowercase the scheme too: fireflyClient now matches case-insensitively, but
  // keeping the emitted URL lowercase is defensive and consistent with the other
  // image.adobe.io adapter (Photoshop).
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw.replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase())
    : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/** Shared singleton. */
export const lightroom = new LightroomAdapter();
