# Adobe Firefly — Audio/Video (Media) (`adobe-firefly-media`)

> Long-running Audio/Video generation: text-to-video, image-to-video, audio/video translation,
> speech, and sound effects. The longest jobs in the family (minutes).

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **ID**        | `adobe-firefly-media`                            |
| **Category**  | Adobe Firefly Services — Core Generative         |
| **Requires**  | `adobe-firefly-core`                             |
| **Conflicts** | none                                             |
| **Branch**    | `feature/generator-template-adobe-firefly-media` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `MediaGenerationPort` + `fireflyMedia` adapter with five operations: `textToVideo`,
`imageToVideo`, `translateAudioVideo`, `generateSpeech`, `soundEffect`. Each presigns its IO,
submits an async job, and resolves to the output href.

## Service & API

- **Host:** `firefly-api.adobe.io` (the core `ADOBE_FIREFLY_BASE_URL`) — **not** image.adobe.io.
  The shared `fireflyClient` posts **relative** paths (`/v3/videos/*-async`, `/v3/audio/*-async`,
  and `/v3/audio-video/translate-async` for `translateAudioVideo`).
- **Auth:** IMS Server-to-Server (inherited from core).
- **Wait:** `jobPort.await(handle)` — polling **or** webhook, transparently (the firefly-api job path,
  not the image.adobe.io always-poll). Guards a missing `jobId`.
- **Partner models:** Veo / Runway / Kling / ElevenLabs are passed as **opaque `model` ids** where
  your entitlement allows — forwarded unchanged, no partner SDKs.

## Install

`hexagen add adobe-firefly-media`. Question:

| Question                  | Default                                     |
| ------------------------- | ------------------------------------------- |
| `partner_model` (boolean) | `false` — acknowledge partner-model routing |

Env: `ADOBE_FIREFLY_MEDIA_MODEL`. Emits `media-generation.port.ts`, `firefly-media.adapter.ts`,
`.env.adobe-media.example`.

## Usage

```ts
import { fireflyMedia } from "@/infrastructure/adobe/media/firefly-media.adapter";

await fireflyMedia.textToVideo({
  prompt: "a kite over dunes at dawn",
  outputHref: "s3://b/out/kite.mp4",
});
await fireflyMedia.imageToVideo({
  inputHref,
  outputHref,
  prompt: "slow push-in",
});
await fireflyMedia.translateAudioVideo({
  inputHref,
  outputHref,
  targetLocale: "es-ES",
});
await fireflyMedia.generateSpeech({
  text: "Welcome",
  outputHref,
  voiceId: "narrator",
});
await fireflyMedia.soundEffect({ prompt: "distant thunder", outputHref });

// partner model (where entitled) — opaque id, no SDK:
await fireflyMedia.textToVideo({ prompt: "...", outputHref, model: "veo-3" });
```

## Configuration

| Env var                     | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `ADOBE_FIREFLY_MEDIA_MODEL` | default model id (also `MediaOptions.model`); verify against Adobe docs |

## Notes for agents

- **Longest-running jobs in the family.** These are firefly-api webhook-delivering jobs, so
  `ADOBE_WEBHOOK_TIMEOUT_MS` **does** apply (unlike the image.adobe.io services) — prefer
  `job_mode=webhook` and raise it; if polling, raise `ADOBE_JOB_POLL_INTERVAL_MS`.
- Each method resolves to a single output href (`done.outputs[0]`).
- Presign IO via core passthrough or a `storage-*` addon.

## Checklist (post-install)

Confirm the Audio/Video entitlement/scope; verify the `/v3/videos/*`, `/v3/audio/*`, and
`/v3/audio-video/translate-async` endpoints;
tune webhook/poll timeouts for the long jobs; supply presigned IO; set the default model; pass partner
models as opaque ids. Optional SDK: `npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Sibling Core Generative services:
[`adobe-firefly-generate`](../adobe-firefly-generate), [`adobe-firefly-upscale`](../adobe-firefly-upscale),
[`adobe-firefly-composite`](../adobe-firefly-composite).
