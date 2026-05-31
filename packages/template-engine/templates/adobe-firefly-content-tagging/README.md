# Adobe Firefly — Content Tagging (`adobe-firefly-content-tagging`)

> The one Firefly service whose result is JSON, not an asset: structured tags/metadata
> for an image. Exercises the foundation's non-asset (`data`) path.

|               |                                                            |
| ------------- | ---------------------------------------------------------- |
| **ID**        | `adobe-firefly-content-tagging`                            |
| **Category**  | Adobe Firefly Services — Core Generative                   |
| **Requires**  | `adobe-firefly-core`                                       |
| **Conflicts** | none                                                       |
| **Branch**    | `feature/generator-template-adobe-firefly-content-tagging` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `ContentTaggingPort` + `fireflyContentTagging` adapter. `tag(inputHref)` returns a
`ContentTaggingResult` (`tags: { name, confidence? }[]` plus the `raw` payload). Tags below
the configured confidence floor are dropped. Feeds search/personalization.

## Service & API

- **Host:** `firefly-api.adobe.io` (via core). Handles both a **sync** response (tags inline)
  and a **short async** job — works either way.
- **Auth:** IMS Server-to-Server (inherited). Presigns the **input only** (the result is
  JSON, so no output storage is needed).

## Install

`hexagen add adobe-firefly-content-tagging`. Question:

| Question         | Options (default)                                             |
| ---------------- | ------------------------------------------------------------- |
| `min_confidence` | `0` / `0.5` / `0.7` (`0.5`) — drop tags below this confidence |

Env: `ADOBE_TAGGING_MIN_CONFIDENCE`. Emits `content-tagging.port.ts`,
`content-tagging.adapter.ts`, `.env.adobe-content-tagging.example`.

## Usage

```ts
import { fireflyContentTagging } from "@/infrastructure/adobe/content-tagging/content-tagging.adapter";

const res = await fireflyContentTagging.tag("s3://bucket/in/photo.jpg");
if (res.success) {
  for (const t of res.value.tags) console.log(t.name, t.confidence);
}
```

## Configuration

| Env var                        | Purpose                                          |
| ------------------------------ | ------------------------------------------------ |
| `ADOBE_TAGGING_MIN_CONFIDENCE` | confidence floor; tags below it are filtered out |

## Notes for agents

- This is the foundation's **non-asset path**: results arrive as `JobOutput.data`, not `href`.
- Only the input is presigned (core passthrough or a `storage-*` addon).

## Checklist (post-install)

Confirm the Content Tagging entitlement/scope; verify the path (sync + short-async both
handled); supply a presigned input href; tune the confidence floor via env. Optional SDK:
`npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core).
