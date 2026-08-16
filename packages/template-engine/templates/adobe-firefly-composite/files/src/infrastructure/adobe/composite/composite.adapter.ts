// @hexagen-server-only
import type {
  CompositePort,
  CompositeRequest,
} from "../../../domain/ports/out/composite.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { toCreativeServiceError } from "../errors/to-creative-service-error";
import { CreativeServiceError } from "../../../domain/errors/creative-service-error";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Firefly Composite adapter — the AWS-of-Adobe↔domain boundary for
 * {@link CompositePort}.
 *
 * Presigns the product + scene inputs and the output, submits the async composite
 * job through the shared `fireflyClient`, awaits completion via `FireflyJobPort`
 * (polling or webhook, transparently), and returns the candidate output href(s).
 * Failures convert to a `Result` at this boundary.
 *
 * NOTE: Firefly paths/payloads version frequently — verify against Adobe docs.
 */
const ENDPOINT = "/v3/images/composite-async";

// Empty/invalid env is treated as unset and falls back to the install default —
// `??` would let "" through (a NaN model / candidate count).
const DEFAULT_MODEL = process.env.ADOBE_FIREFLY_DEFAULT_MODEL?.trim() || "firefly_v3";
const DEFAULT_CANDIDATES = resolveCandidates(process.env.ADOBE_COMPOSITE_CANDIDATES);

function isValidCandidates(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

function resolveCandidates(raw: string | undefined): number {
  const fallback = Number("{default_candidates}");
  const value = Number(raw?.trim() || "{default_candidates}");
  return isValidCandidates(value) ? value : fallback;
}

export class FireflyCompositeAdapter implements CompositePort {
  async composite(req: CompositeRequest): Promise<Result<string[], CreativeServiceError>> {
    // Validate the caller's count up front (the env default is already validated)
    // rather than letting an out-of-range value reach the API as a 400. This
    // returns the port's own failure type directly: the request never reached the
    // vendor, so there is no vendor error to map (ADR-0053 §1).
    if (req.numVariations !== undefined && !isValidCandidates(req.numVariations)) {
      return err(
        new CreativeServiceError(
          "invalid-request",
          `Invalid candidate count ${JSON.stringify(req.numVariations)} — must be an integer between 1 and 10.`,
        ),
      );
    }

    try {
      const storage = getStoragePresigner();
      const product = await storage.presignInput(req.productHref);
      const scene = await storage.presignInput(req.sceneHref);
      const output = await storage.presignOutput(req.outputHref);

      const body: Record<string, unknown> = {
        product: external(product.href),
        scene: external(scene.href),
        output: external(output.href),
        model: req.model?.trim() || DEFAULT_MODEL,
        numVariations: req.numVariations ?? DEFAULT_CANDIDATES,
      };
      if (req.prompt) body.prompt = req.prompt;
      // Policy flags pass through verbatim — never hardcoded.
      if (req.contentCredentials !== undefined) body.contentCredentials = req.contentCredentials;
      if (req.safety !== undefined) body.safety = req.safety;

      const handle = toJobHandle(await fireflyClient.post(ENDPOINT, body));
      if (!handle.jobId) {
        return err(new CreativeServiceError("unknown", "Composite submit response did not include a job id."));
      }
      const done = await jobPort.await(handle);
      if (done.status !== "succeeded") {
        return err(new CreativeServiceError("unknown", done.error ?? "Composite job did not succeed."));
      }
      // Multiple candidates — return them all.
      const hrefs = done.outputs
        .map((o) => o.href)
        .filter((href): href is string => Boolean(href));
      if (hrefs.length === 0) {
        return err(new CreativeServiceError("unknown", "Composite job produced no output."));
      }
      return ok(hrefs);
    } catch (error) {
      return err(toCreativeServiceError(error));
    }
  }
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

/** Shared singleton. */
export const fireflyComposite = new FireflyCompositeAdapter();
