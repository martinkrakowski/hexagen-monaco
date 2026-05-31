# Adobe Firefly — Generate (`adobe-firefly-generate`)

> The flagship Firefly service: text-to-image plus the image-edit operations
> (generative fill/expand, image-to-image, style transfer). Returns candidate hrefs.

|               |                                                     |
| ------------- | --------------------------------------------------- |
| **ID**        | `adobe-firefly-generate`                            |
| **Category**  | Adobe Firefly Services — Core Generative            |
| **Requires**  | `adobe-firefly-core`                                |
| **Conflicts** | none                                                |
| **Branch**    | `feature/generator-template-adobe-firefly-generate` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `ImageGenerationPort` + `fireflyGenerate` adapter. Text-to-image generates from a
prompt; the edit operations transform a presigned input. Async via `FireflyJobPort`;
Content Credentials (C2PA) and safety/moderation pass through as per-call options.

## Service & API

- **Host:** `firefly-api.adobe.io` (via core). **Async** endpoints:
  `/v3/images/{generate,fill,expand}-async` (the sync endpoints return no job).
- **Auth:** IMS Server-to-Server (inherited from core).
- Each method resolves to **`string[]`** — one href per requested variation.

## Install

`hexagen add adobe-firefly-generate`. Questions:

| Question                   | Options (default)                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `operations` (multiselect) | `text-to-image`, `generative-fill`, `generative-expand`, `image-to-image`, `style-transfer` (`["text-to-image"]`) |
| `default_size`             | `1024x1024` / `2048x2048` / `1792x1024` (`2048x2048`)                                                             |

Env: `ADOBE_FIREFLY_DEFAULT_MODEL`, `ADOBE_FIREFLY_SIZE`. Emits
`image-generation.port.ts`, `firefly-generate.adapter.ts`, `.env.adobe-generate.example`.

## Usage

```ts
import { fireflyGenerate } from "@/infrastructure/adobe/generate/firefly-generate.adapter";

const res = await fireflyGenerate.textToImage({
  prompt: "a teal ceramic mug on oak, soft window light",
  outputHref: "s3://bucket/out/mug.png",
  numVariations: 2,
  contentCredentials: true,
});
if (res.success) for (const href of res.value) console.log(href);
else console.error(res.error.message);

// Edit ops take a presigned input + (optional) mask:
await fireflyGenerate.generativeFill({
  inputHref,
  outputHref,
  maskHref,
  prompt,
});
```

## Configuration

| Env var                       | Purpose                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `ADOBE_FIREFLY_DEFAULT_MODEL` | per-environment model override (also `GenerateOptions.model`) |
| `ADOBE_FIREFLY_SIZE`          | install-set default output size (also `GenerateOptions.size`) |

## Notes for agents

- `contentCredentials` and `safety` are **pass-through per-call options**, never hardcoded.
- Edit ops need presigned input + output hrefs (core passthrough or a `storage-*` addon).
- Firefly paths version frequently — verify against Adobe docs.

## Checklist (post-install)

Confirm the Generate entitlement/scope; verify the async endpoints; supply presigned IO
for edit ops; set credentials/safety per call; override the model via env. Optional SDK:
`npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Sibling services:
[`adobe-firefly-upscale`](../adobe-firefly-upscale), [`adobe-firefly-composite`](../adobe-firefly-composite).
