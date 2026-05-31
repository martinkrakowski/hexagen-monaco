# Adobe Firefly — Upscale (`adobe-firefly-upscale`)

> The lightest Firefly service: submit an async upscale job and get one output href.
> A good end-to-end validation of the `adobe-firefly-core` foundation.

|               |                                                    |
| ------------- | -------------------------------------------------- |
| **ID**        | `adobe-firefly-upscale`                            |
| **Category**  | Adobe Firefly Services — Core Generative           |
| **Requires**  | `adobe-firefly-core`                               |
| **Conflicts** | none                                               |
| **Branch**    | `feature/generator-template-adobe-firefly-upscale` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `UpscalePort` + `fireflyUpscale` adapter. One method, `upscale(req)`, submits an
async job through the core client/job port and resolves to the upscaled output href.

## Service & API

- **Host:** `firefly-api.adobe.io` (via core). Posts to `/v3/images/upscale`.
- **Auth:** IMS Server-to-Server (inherited). Resolves to a single **`string`** href.

## Install

`hexagen add adobe-firefly-upscale`. Question:

| Question         | Options (default)                                               |
| ---------------- | --------------------------------------------------------------- |
| `default_factor` | `2` / `4` (`2`) — override per call via `UpscaleRequest.factor` |

Env: `ADOBE_UPSCALE_FACTOR`. Emits `upscale.port.ts`, `upscale.adapter.ts`,
`.env.adobe-upscale.example`.

## Usage

```ts
import { fireflyUpscale } from "@/infrastructure/adobe/upscale/upscale.adapter";

const res = await fireflyUpscale.upscale({
  inputHref: "s3://bucket/in/small.png",
  outputHref: "s3://bucket/out/large.png",
  factor: 4, // optional; default from ADOBE_UPSCALE_FACTOR
});
if (res.ok) console.log(res.value);
```

## Configuration

| Env var                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `ADOBE_UPSCALE_FACTOR` | install-set default factor (also `UpscaleRequest.factor`) |

## Notes for agents

- Provide presigned input/output hrefs (core passthrough) or install a `storage-*` addon.
- Verify the endpoint against Adobe docs — Firefly paths version frequently.

## Checklist (post-install)

Confirm the Upscale entitlement/scope; verify `/v3/images/upscale`; supply presigned IO.
Optional SDK: `npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core).
