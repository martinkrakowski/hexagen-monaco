# Adobe Photoshop API (`adobe-photoshop`)

> Photoshop automation: Smart Object replacement, text-layer edits, action JSON, crop,
> and PSD rendering — inputs are named layers in a pre-authored `.psd`.

|               |                                              |
| ------------- | -------------------------------------------- |
| **ID**        | `adobe-photoshop`                            |
| **Category**  | Adobe Firefly Services — Creative Automation |
| **Requires**  | `adobe-firefly-core`                         |
| **Conflicts** | none                                         |
| **Branch**    | `feature/generator-template-adobe-photoshop` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `PhotoshopAutomationPort` + `photoshopAutomation` adapter with five operations:
`smartObject`, `editTextLayer`, `applyActionJson`, `crop`, `renderPsd`. Each presigns its
IO, submits an async job, and resolves to a single output href.

## Service & API

- **Host:** `image.adobe.io/pie/psdService` — a **different host** than `firefly-api.adobe.io`;
  the adapter posts **absolute URLs** through the shared `fireflyClient`.
- **Auth:** same IMS Server-to-Server token (inherited from core).
- **Wait:** centralised `jobPort.poll(handle)` with a status-URL-required guard.

## Install

`hexagen add adobe-photoshop`. Questions:

| Question                   | Options (default)                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `operations` (multiselect) | `smartObject`, `editTextLayer`, `applyActionJson`, `crop`, `renderPsd` (`["smartObject"]`) |
| `output_format`            | `jpeg` / `png` (`jpeg`) — `renderPsd` default                                              |

Env: `ADOBE_PHOTOSHOP_BASE_URL`, `ADOBE_PHOTOSHOP_FORMAT`. Emits
`photoshop-automation.port.ts`, `photoshop-automation.adapter.ts`,
`.env.adobe-photoshop.example`.

## Usage

```ts
import { photoshopAutomation } from "@/infrastructure/adobe/photoshop/photoshop-automation.adapter";

const res = await photoshopAutomation.smartObject({
  inputHref: "s3://bucket/in/template.psd",
  outputHref: "s3://bucket/out/render.png",
  layerName: "hero", // a named Smart Object in the .psd
  replacementHref: "s3://bucket/in/product.png",
});
if (res.ok) console.log(res.value);

await photoshopAutomation.editTextLayer({
  inputHref,
  outputHref,
  layerName: "headline",
  text: "50% off",
});
await photoshopAutomation.renderPsd({ inputHref, outputHref, format: "png" });
```

## Configuration

| Env var                    | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `ADOBE_PHOTOSHOP_BASE_URL` | host override (default `https://image.adobe.io`) |
| `ADOBE_PHOTOSHOP_FORMAT`   | `renderPsd` default format (`jpeg`/`png`)        |

## Notes for agents

- **The input `.psd` must contain the named Smart Object / text layers** — `smartObject` /
  `editTextLayer` target by name and fail if absent.
- Provide presigned `.psd`, replacement-image, and output hrefs.

## Checklist (post-install)

Confirm the Photoshop API entitlement/scope; verify endpoints on `image.adobe.io/pie/psdService`;
ensure the `.psd` has named layers; supply presigned IO; set the render format. Optional SDK:
`npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Same host family:
[`adobe-lightroom`](../adobe-lightroom), [`adobe-illustrator`](../adobe-illustrator),
[`adobe-indesign`](../adobe-indesign).
