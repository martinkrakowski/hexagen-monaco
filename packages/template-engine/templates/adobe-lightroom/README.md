# Adobe Lightroom API (`adobe-lightroom`)

> Lightroom automation: auto-tone, preset application, and parametric edits — batch-oriented
> photo editing / colour grading.

|               |                                              |
| ------------- | -------------------------------------------- |
| **ID**        | `adobe-lightroom`                            |
| **Category**  | Adobe Firefly Services — Creative Automation |
| **Requires**  | `adobe-firefly-core`                         |
| **Conflicts** | none                                         |
| **Branch**    | `feature/generator-template-adobe-lightroom` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `LightroomPort` + `lightroom` adapter with `autoTone`, `applyPreset`, and `edit`
(parametric `Record<string, unknown>` edits). Each presigns IO, submits an async job, and
resolves to a single output href.

## Service & API

- **Host:** `image.adobe.io/lrService` — same host as Photoshop, different service path; the
  adapter posts **absolute URLs** through `fireflyClient`.
- **Auth:** IMS Server-to-Server (inherited). **Wait:** centralised `jobPort.poll(handle)`.

## Install

`hexagen add adobe-lightroom`. Questions:

| Question                   | Options (default)                                  |
| -------------------------- | -------------------------------------------------- |
| `operations` (multiselect) | `autoTone`, `applyPreset`, `edit` (`["autoTone"]`) |
| `output_format`            | `jpeg` / `png` (`jpeg`)                            |

Env: `ADOBE_LIGHTROOM_BASE_URL`, `ADOBE_LIGHTROOM_FORMAT`. Emits `lightroom.port.ts`,
`lightroom.adapter.ts`, `.env.adobe-lightroom.example`.

## Usage

```ts
import { lightroom } from "@/infrastructure/adobe/lightroom/lightroom.adapter";

await lightroom.autoTone({ inputHref, outputHref });
await lightroom.applyPreset({
  inputHref,
  outputHref,
  presetHref: "s3://bucket/presets/warm.xmp",
});
await lightroom.edit({
  inputHref,
  outputHref,
  edits: { Exposure: 0.4, Contrast: 12 },
});
```

## Configuration

| Env var                    | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `ADOBE_LIGHTROOM_BASE_URL` | host override (default `https://image.adobe.io`) |
| `ADOBE_LIGHTROOM_FORMAT`   | install-set default output format                |

## Notes for agents

- **Batch-oriented:** drive `autoTone`/`edit` over many images by calling the port per asset
  (or fan out with the `bullmq` template).
- Provide presigned input (+ preset for `applyPreset`) and output hrefs.

## Checklist (post-install)

Confirm the Lightroom entitlement/scope; verify endpoints on `image.adobe.io/lrService`;
supply presigned IO; set the output format; fan out for batches. Optional SDK:
`npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Same host family:
[`adobe-photoshop`](../adobe-photoshop), [`adobe-illustrator`](../adobe-illustrator),
[`adobe-indesign`](../adobe-indesign).
