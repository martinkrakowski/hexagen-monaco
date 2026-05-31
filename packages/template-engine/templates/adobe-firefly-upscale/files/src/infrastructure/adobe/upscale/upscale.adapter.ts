// @hexagen-server-only
import type {
  UpscalePort,
  UpscaleRequest,
} from "../../../domain/ports/out/upscale.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Firefly Upscale adapter — the AWS-of-Adobe↔domain boundary for {@link UpscalePort}.
 *
 * Presigns the IO hrefs (passthrough unless a storage addon is installed), submits
 * the async upscale job through the shared `fireflyClient`, awaits completion via
 * `FireflyJobPort` (polling or webhook, transparently), and returns the output
 * href. All failures are converted to a `Result` at this boundary — the foundation
 * throws typed `FireflyError`s, the port surfaces them.
 */
const DEFAULT_FACTOR = Number(process.env.ADOBE_UPSCALE_FACTOR ?? "{default_factor}");

export class FireflyUpscaleAdapter implements UpscalePort {
  async upscale(req: UpscaleRequest): Promise<Result<string, FireflyError>> {
    try {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const output = await storage.presignOutput(req.outputHref);

      const handle = toJobHandle(
        await fireflyClient.post("/v3/images/upscale", {
          image: { href: input.href, storage: "external" },
          output: { href: output.href, storage: "external" },
          factor: req.factor ?? DEFAULT_FACTOR,
        }),
      );

      const done = await jobPort.await(handle);
      const href = done.outputs[0]?.href;
      if (done.status !== "succeeded" || !href) {
        return err(new FireflyError(done.error ?? "Upscale job did not produce an output"));
      }
      return ok(href);
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }
}

/** Shared singleton. */
export const fireflyUpscale = new FireflyUpscaleAdapter();
