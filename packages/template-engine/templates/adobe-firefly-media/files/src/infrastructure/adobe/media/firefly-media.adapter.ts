// @hexagen-server-only
import type {
  GenerateSpeechRequest,
  ImageToVideoRequest,
  MediaGenerationPort,
  MediaOptions,
  SoundEffectRequest,
  TextToVideoRequest,
  TranslateAudioVideoRequest,
} from "../../../domain/ports/out/media-generation.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { toJobHandle } from "../jobs/job-result";
import { getStoragePresigner } from "../storage/passthrough-storage.adapter";
import { toCreativeServiceError } from "../errors/to-creative-service-error";
import { CreativeServiceError } from "../../../domain/errors/creative-service-error";
import { ok, err, type Result } from "../../../shared/result";

/**
 * Firefly Audio/Video (Media) adapter — the boundary for {@link MediaGenerationPort}.
 *
 * Unlike the image.adobe.io services, Media runs on firefly-api.adobe.io (the core
 * ADOBE_FIREFLY_BASE_URL), so the shared `fireflyClient` posts RELATIVE paths and
 * each call awaits completion via `FireflyJobPort` (polling OR webhook,
 * transparently) — NOT the image.adobe.io always-poll path.
 *
 * These are the LONGEST jobs in the family (minutes). Prefer webhook job_mode and
 * raise ADOBE_WEBHOOK_TIMEOUT_MS; if polling, scale ADOBE_JOB_POLL_INTERVAL_MS up.
 *
 * Partner-model routing acknowledged at install (partner_model={partner_model}).
 * Pass a partner model id (Veo / Runway / Kling / ElevenLabs, where entitled) as the
 * opaque `model` option — it is forwarded unchanged; no partner SDKs are bundled.
 *
 * NOTE: paths/payloads version frequently — verify against Adobe docs.
 */
const DEFAULT_MODEL =
  process.env.ADOBE_FIREFLY_MEDIA_MODEL?.trim() || "firefly-video-v1";

export class FireflyMediaAdapter implements MediaGenerationPort {
  async textToVideo(
    req: TextToVideoRequest,
  ): Promise<Result<string, CreativeServiceError>> {
    return this.run(async () => {
      const output = await getStoragePresigner().presignOutput(req.outputHref);
      return {
        path: "/v3/videos/generate-async",
        body: withOptions({ prompt: req.prompt, output: external(output.href) }, req),
      };
    });
  }

  async imageToVideo(
    req: ImageToVideoRequest,
  ): Promise<Result<string, CreativeServiceError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const output = await storage.presignOutput(req.outputHref);
      return {
        path: "/v3/videos/generate-async",
        body: withOptions(
          { image: external(input.href), prompt: req.prompt, output: external(output.href) },
          req,
        ),
      };
    });
  }

  async translateAudioVideo(
    req: TranslateAudioVideoRequest,
  ): Promise<Result<string, CreativeServiceError>> {
    return this.run(async () => {
      const storage = getStoragePresigner();
      const input = await storage.presignInput(req.inputHref);
      const output = await storage.presignOutput(req.outputHref);
      return {
        path: "/v3/audio-video/translate-async",
        body: withOptions(
          {
            input: external(input.href),
            targetLocale: req.targetLocale,
            output: external(output.href),
          },
          req,
        ),
      };
    });
  }

  async generateSpeech(
    req: GenerateSpeechRequest,
  ): Promise<Result<string, CreativeServiceError>> {
    return this.run(async () => {
      const output = await getStoragePresigner().presignOutput(req.outputHref);
      const body: Record<string, unknown> = {
        text: req.text,
        output: external(output.href),
      };
      if (req.voiceId !== undefined) body.voiceId = req.voiceId;
      return { path: "/v3/audio/speech-async", body: withOptions(body, req) };
    });
  }

  async soundEffect(
    req: SoundEffectRequest,
  ): Promise<Result<string, CreativeServiceError>> {
    return this.run(async () => {
      const output = await getStoragePresigner().presignOutput(req.outputHref);
      return {
        path: "/v3/audio/sound-effect-async",
        body: withOptions({ prompt: req.prompt, output: external(output.href) }, req),
      };
    });
  }

  private async run(
    build: () => Promise<{ path: string; body: unknown }>,
  ): Promise<Result<string, CreativeServiceError>> {
    try {
      const { path, body } = await build();
      const handle = toJobHandle(await fireflyClient.post(path, body));
      // A missing job id (e.g. an empty 202 body) can't be correlated and would
      // collide in webhook mode — fail here with a precise error.
      if (!handle.jobId) {
        return err(
          new CreativeServiceError("unknown", "Media submit response did not include a job id."),
        );
      }
      // Long (minutes) jobs: await transparently polls or resolves a webhook.
      const done = await jobPort.await(handle);
      const href = done.outputs[0]?.href;
      if (done.status !== "succeeded" || !href) {
        return err(
          new CreativeServiceError("unknown", done.error ?? "Media job did not produce an output."),
        );
      }
      return ok(href);
    } catch (error) {
      return err(toCreativeServiceError(error));
    }
  }
}

function external(href: string): { href: string; storage: "external" } {
  return { href, storage: "external" };
}

// Forward the install/partner model (or the per-call override) plus an optional seed.
function withOptions(
  body: Record<string, unknown>,
  opts: MediaOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...body,
    model: opts.model?.trim() || DEFAULT_MODEL,
  };
  if (opts.seed !== undefined) out.seed = opts.seed;
  return out;
}

/** Shared singleton. */
export const fireflyMedia = new FireflyMediaAdapter();
