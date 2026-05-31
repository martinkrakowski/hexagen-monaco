import type { Result } from "../../../shared/result";
// Type-only import of the infrastructure error (erased at compile) — the deliberate
// domain→infra decoupling for the port's failure channel, not an oversight.
import type { FireflyError } from "../../../infrastructure/adobe/errors/firefly-errors";

/**
 * Outbound port for the Adobe Firefly Audio/Video (Media) API.
 *
 * Long-running async generation: text-to-video, image-to-video, audio/video
 * translation, speech, and sound effects. Every method resolves to the output
 * href. Hrefs are presigned URLs (`storage: "external"`).
 */
export interface MediaOptions {
  /**
   * Opaque model id. Defaults to the install-configured model; pass a partner
   * model id (Veo / Runway / Kling / ElevenLabs, where your entitlement allows)
   * and it is forwarded unchanged — no partner SDKs are involved.
   */
  readonly model?: string;
  /** Per-call seed for reproducibility. */
  readonly seed?: number;
}

export interface TextToVideoRequest extends MediaOptions {
  /** Text prompt describing the video. */
  readonly prompt: string;
  /** Presigned destination the rendered video is written to. */
  readonly outputHref: string;
}

export interface ImageToVideoRequest extends MediaOptions {
  /** Presigned source / first-frame image. */
  readonly inputHref: string;
  /** Presigned destination the rendered video is written to. */
  readonly outputHref: string;
  /** Optional motion/style prompt. */
  readonly prompt?: string;
}

export interface TranslateAudioVideoRequest extends MediaOptions {
  /** Presigned source audio/video. */
  readonly inputHref: string;
  /** Presigned destination the translated asset is written to. */
  readonly outputHref: string;
  /** Target locale, e.g. `es-ES`. */
  readonly targetLocale: string;
}

export interface GenerateSpeechRequest extends MediaOptions {
  /** Text to synthesise. */
  readonly text: string;
  /** Presigned destination the audio is written to. */
  readonly outputHref: string;
  /** Optional voice id. */
  readonly voiceId?: string;
}

export interface SoundEffectRequest extends MediaOptions {
  /** Text prompt describing the sound effect. */
  readonly prompt: string;
  /** Presigned destination the audio is written to. */
  readonly outputHref: string;
}

export interface MediaGenerationPort {
  /** Generate a video from a text prompt. */
  textToVideo(req: TextToVideoRequest): Promise<Result<string, FireflyError>>;
  /** Animate a source image into a video. */
  imageToVideo(req: ImageToVideoRequest): Promise<Result<string, FireflyError>>;
  /** Translate the audio/video of a source asset into another locale. */
  translateAudioVideo(
    req: TranslateAudioVideoRequest,
  ): Promise<Result<string, FireflyError>>;
  /** Synthesise speech from text. */
  generateSpeech(
    req: GenerateSpeechRequest,
  ): Promise<Result<string, FireflyError>>;
  /** Generate a sound effect from a text prompt. */
  soundEffect(req: SoundEffectRequest): Promise<Result<string, FireflyError>>;
}
