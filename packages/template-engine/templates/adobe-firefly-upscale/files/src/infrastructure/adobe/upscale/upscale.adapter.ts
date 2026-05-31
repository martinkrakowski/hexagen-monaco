// @hexagen-server-only
import type {
  UpscalePort,
  UpscaleRequest,
} from "../../../domain/ports/out/upscale.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import {
  classifyAdobeError,
  FireflyError,
  FireflyValidationError,
} from "../errors/firefly-errors";
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
// The install default is always a valid select value ("2"/"4"); fall back to it
// if ADOBE_UPSCALE_FACTOR is unset or misconfigured, so a bad env never yields
// NaN/0 to the API.
const FALLBACK_FACTOR = Number("{default_factor}");

function resolveDefaultFactor(): number {
  const raw = process.env.ADOBE_UPSCALE_FACTOR;
  const parsed = raw ? Number(raw) : FALLBACK_FACTOR;
  return isValidFactor(parsed) ? parsed : FALLBACK_FACTOR;
}

function isValidFactor(factor: number): boolean {
  return Number.isFinite(factor) && factor > 0;
}

const DEFAULT_FACTOR = resolveDefaultFactor();

export class FireflyUpscaleAdapter implements UpscalePort {
  async upscale(req: UpscaleRequest): Promise<Result<string, FireflyError>> {
    const factor = req.factor ?? DEFAULT_FACTOR;
    if (!isValidFactor(factor)) {
      // Don't send NaN/0/negative to the API — fail fast with a config error.
      return err(
        new FireflyValidationError(`Invalid upscale factor ${JSON.stringify(req.factor)} — must be a positive number.`),
      );
    }

    try {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const output = await storage.presignOutput(req.outputHref);

      const handle = toJobHandle(
        await fireflyClient.post("/v3/images/upscale", {
          image: { href: input.href, storage: "external" },
          output: { href: output.href, storage: "external" },
          factor,
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
