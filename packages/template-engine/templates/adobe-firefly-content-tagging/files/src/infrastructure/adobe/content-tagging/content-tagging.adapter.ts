// @hexagen-server-only
import type {
  ContentTag,
  ContentTaggingPort,
  ContentTaggingResult,
} from "../../../domain/ports/out/content-tagging.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Content Tagging adapter — the AWS-of-Adobe↔domain boundary for
 * {@link ContentTaggingPort}.
 *
 * The one service whose result is JSON rather than an asset. It is sync (tags
 * returned inline) or a short async job, so the adapter handles BOTH: it submits,
 * and only awaits via `FireflyJobPort` when the response carried a job id —
 * otherwise it reads the tags straight from the response. Either way the payload
 * flows through the foundation's non-asset path (`JobResult.outputs[].data`).
 *
 * NOTE: Firefly paths/payloads version frequently — verify against Adobe docs.
 */
const ENDPOINT = "/v3/images/tag";

// Confidence floor. Empty/invalid env falls back to the (always-valid) install
// default rather than producing NaN — `??` would let "" through.
const MIN_CONFIDENCE = resolveMinConfidence(process.env.ADOBE_TAGGING_MIN_CONFIDENCE);

function resolveMinConfidence(raw: string | undefined): number {
  const fallback = Number("{min_confidence}");
  const value = Number(raw?.trim() || "{min_confidence}");
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

export class FireflyContentTaggingAdapter implements ContentTaggingPort {
  async tag(inputHref: string): Promise<Result<ContentTaggingResult, FireflyError>> {
    try {
      const input = await getStoragePresigner().presignInput(inputHref);
      const response = await fireflyClient.post<unknown>(ENDPOINT, {
        image: { href: input.href, storage: "external" },
      });

      // Sync path: tags returned inline (no job id). Async path: await the job and
      // read its non-asset `data`. Note: unlike the image services this does NOT
      // require a job id — an empty one just means the response was synchronous.
      let payload: unknown = response;
      const handle = toJobHandle(response);
      if (handle.jobId) {
        const done = await jobPort.await(handle);
        if (done.status !== "succeeded") {
          return err(new FireflyError(done.error ?? "Content tagging job did not succeed."));
        }
        payload = done.outputs[0]?.data ?? response;
      }

      return ok({ tags: extractTags(payload), raw: payload });
    } catch (error) {
      return err(classifyAdobeError(error));
    }
  }
}

/** Flatten a (per-tenant-variable) tag payload to the domain shape, applying the floor. */
function extractTags(payload: unknown): ContentTag[] {
  const source = (payload ?? {}) as {
    tags?: unknown;
    outputs?: Array<{ tags?: unknown }>;
  };
  const rawTags = Array.isArray(source.tags)
    ? source.tags
    : Array.isArray(source.outputs?.[0]?.tags)
      ? (source.outputs![0]!.tags as unknown[])
      : [];

  return (rawTags as unknown[]).flatMap((entry) => {
    const tag = toTag(entry);
    if (!tag) return [];
    if (tag.confidence !== undefined && tag.confidence < MIN_CONFIDENCE) return [];
    return [tag];
  });
}

function toTag(entry: unknown): ContentTag | undefined {
  if (typeof entry === "string") return { name: entry };
  if (entry && typeof entry === "object") {
    const obj = entry as { name?: unknown; tag?: unknown; confidence?: unknown };
    const name =
      typeof obj.name === "string" ? obj.name : typeof obj.tag === "string" ? obj.tag : undefined;
    if (name) {
      return {
        name,
        confidence: typeof obj.confidence === "number" ? obj.confidence : undefined,
      };
    }
  }
  return undefined;
}

/** Shared singleton. */
export const fireflyContentTagging = new FireflyContentTaggingAdapter();
