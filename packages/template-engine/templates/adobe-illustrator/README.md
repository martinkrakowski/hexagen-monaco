# Adobe Illustrator API (`adobe-illustrator`)

> Illustrator automation: artboard rendering, variable-data merge, and vector scaling
> (vector→raster at arbitrary scale — ads to billboards).

|               |                                                |
| ------------- | ---------------------------------------------- |
| **ID**        | `adobe-illustrator`                            |
| **Category**  | Adobe Firefly Services — Creative Automation   |
| **Requires**  | `adobe-firefly-core`                           |
| **Conflicts** | none                                           |
| **Branch**    | `feature/generator-template-adobe-illustrator` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `IllustratorPort` + `illustrator` adapter with `renderArtboard`, `dataMerge`
(variable-data `Record<string, unknown>` into an `.ai`), and `scaleVector`. Each presigns
IO, submits an async job, and resolves to a single output href.

## Service & API

- **Host:** `image.adobe.io` (same host family as Photoshop/Lightroom); posts **absolute URLs**.
- **Auth:** IMS Server-to-Server (inherited). **Wait:** centralised `jobPort.poll(handle)`.
- **Formats:** `png` / `jpeg` / `pdf` (`IllustratorFormat`).

## Install

`hexagen add adobe-illustrator`. Questions:

| Question                   | Options (default)                                                   |
| -------------------------- | ------------------------------------------------------------------- |
| `operations` (multiselect) | `renderArtboard`, `dataMerge`, `scaleVector` (`["renderArtboard"]`) |
| `output_format`            | `png` / `jpeg` / `pdf` (`png`)                                      |

Env: `ADOBE_ILLUSTRATOR_BASE_URL`, `ADOBE_ILLUSTRATOR_FORMAT`. Emits `illustrator.port.ts`,
`illustrator.adapter.ts`, `.env.adobe-illustrator.example`.

## Usage

```ts
import { illustrator } from "@/infrastructure/adobe/illustrator/illustrator.adapter";

await illustrator.renderArtboard({
  inputHref,
  outputHref,
  artboard: 1,
  scale: 2,
});
await illustrator.dataMerge({
  inputHref,
  outputHref,
  data: { name: "Acme", price: "$9" },
});
await illustrator.scaleVector({ inputHref, outputHref, width: 6000 }); // vector→raster at scale
```

## Configuration

| Env var                      | Purpose                                          |
| ---------------------------- | ------------------------------------------------ |
| `ADOBE_ILLUSTRATOR_BASE_URL` | host override (default `https://image.adobe.io`) |
| `ADOBE_ILLUSTRATOR_FORMAT`   | install-set default output format                |

## Notes for agents

- **Vector→raster at arbitrary scale:** pass `scale` / `width` / `height` on the request.
- Provide presigned `.ai` + output hrefs (and a data source for `dataMerge`).

## Checklist (post-install)

Confirm the Illustrator entitlement/scope; verify endpoints on `image.adobe.io`; supply
presigned IO; set scale/format. Optional SDK: `npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Same host family:
[`adobe-photoshop`](../adobe-photoshop), [`adobe-lightroom`](../adobe-lightroom),
[`adobe-indesign`](../adobe-indesign).
