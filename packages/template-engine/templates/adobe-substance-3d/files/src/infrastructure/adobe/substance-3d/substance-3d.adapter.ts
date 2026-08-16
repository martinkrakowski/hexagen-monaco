// @hexagen-server-only
import type {
  CompositeRequest,
  RelightRequest,
  RenderRequest,
  Substance3DFormat,
  Substance3DPort,
} from "../../../domain/ports/out/substance-3d.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { toCreativeServiceError } from "../errors/to-creative-service-error";
import { CreativeServiceError } from "../../../domain/errors/creative-service-error";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Adobe Substance 3D adapter — the Substance↔domain boundary for {@link Substance3DPort}.
 *
 * Enabled operations (install): {operations}. The Substance 3D API lives on the
 * image.adobe.io host family (same as Photoshop/Lightroom/Illustrator/InDesign/
 * Express — a different host than firefly-api.adobe.io), so the adapter posts
 * ABSOLUTE URLs; the shared `fireflyClient` passes those through with the same
 * IMS auth. Each call presigns its IO, submits the async job, and awaits the result.
 *
 * These are the LONGEST-RUNNING Firefly jobs. image.adobe.io services don't deliver
 * Firefly webhooks, so the wait ALWAYS goes through the centralised job port's
 * status-URL poll, regardless of the project's job_mode — webhook mode and its
 * timeout knob don't apply here. The poll has no max-wait cap (so a long render is
 * not cut off); raise ADOBE_JOB_POLL_INTERVAL_MS to throttle status checks during
 * long renders.
 *
 * NOTE: host/paths/payloads version frequently — verify against Adobe docs.
 */
const SUBSTANCE_3D_BASE = normalizeBase(
  process.env.ADOBE_SUBSTANCE_3D_BASE_URL?.trim() || "https://image.adobe.io",
);

// Strictly validate the env value rather than blind-casting — an invalid value
// would otherwise reach the API. Fall back to the (always-valid) install default.
const rawDefaultFormat = process.env.ADOBE_SUBSTANCE_3D_FORMAT?.trim();
const DEFAULT_FORMAT: Substance3DFormat =
  rawDefaultFormat === "png" || rawDefaultFormat === "jpg"
    ? rawDefaultFormat
    : "{output_format}";

export class Substance3DAdapter implements Substance3DPort {
  async render(req: RenderRequest): Promise<Result<string, CreativeServiceError>> {
    return this.run(async () => {
      const { input, output } = await this.presignIO(req);
      return {
        path: endpoint("render"),
        body: {
          inputs: [external(input)],
          outputs: [outputSpec(output, req.format ?? DEFAULT_FORMAT)],
        },
      };
    });
  }

  async composite(
    req: CompositeRequest,
  ): Promise<Result<string, CreativeServiceError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const background = await storage.presignInput(req.backgroundHref);
      const output = await storage.presignOutput(req.outputHref);
      return {
        path: endpoint("composite"),
        body: {
          inputs: [external(input.href)],
          options: { background: external(background.href) },
          outputs: [outputSpec(output.href, req.format ?? DEFAULT_FORMAT)],
        },
      };
    });
  }

  async relight(req: RelightRequest): Promise<Result<string, CreativeServiceError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const environment = await storage.presignInput(req.environmentHref);
      const output = await storage.presignOutput(req.outputHref);
      return {
        path: endpoint("relight"),
        body: {
          inputs: [external(input.href)],
          options: { environment: external(environment.href) },
          outputs: [outputSpec(output.href, req.format ?? DEFAULT_FORMAT)],
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
  ): Promise<Result<string, CreativeServiceError>> {
    try {
      const { path, body } = await build();
      const handle = toJobHandle(await fireflyClient.post(path, body));
      // image.adobe.io services are tracked by a status URL (_links.self.href) and
      // are polled regardless of the project's job_mode (they don't deliver Firefly
      // webhooks). A response without a status URL can't be polled, so surface a
      // clear error rather than routing through the job port's await — which only
      // resolves a jobId-only handle in webhook mode and would fail in polling builds.
      if (!handle.statusUrl) {
        return err(
          new CreativeServiceError("unknown", 
            "Substance 3D submit response had no status URL to track the job.",
          ),
        );
      }
      // jobPort.poll() is the centralised always-poll entry point (keeps the wait
      // path on the port rather than importing the poller directly).
      const done = await jobPort.poll(handle);
      if (done.status !== "succeeded") {
        return err(
          new CreativeServiceError("unknown", done.error ?? "Substance 3D job did not succeed."),
        );
      }
      // `done.outputs` is a non-optional JobOutput[] (parseJobResult always returns
      // an array), so `[0]?.href` is enough — an empty array yields the no-output
      // path below; no `?.` on `outputs` itself is needed.
      const href = done.outputs[0]?.href;
      if (!href) {
        return err(new CreativeServiceError("unknown", "Substance 3D job produced no output."));
      }
      return ok(href);
    } catch (error) {
      return err(toCreativeServiceError(error));
    }
  }
}

function endpoint(operation: string): string {
  return `${SUBSTANCE_3D_BASE}/substance-3d/${operation}`;
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

function outputSpec(
  href: string,
  format: Substance3DFormat,
): { href: string; storage: "external"; type: string } {
  const type = format === "png" ? "image/png" : "image/jpeg";
  return { ...external(href), type };
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
export const substance3d = new Substance3DAdapter();
