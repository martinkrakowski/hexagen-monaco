# Adobe InDesign API (`adobe-indesign`)

> InDesign automation: data merge (template + data source), layout rendering, and PDF export.

|               |                                              |
| ------------- | -------------------------------------------- |
| **ID**        | `adobe-indesign`                             |
| **Category**  | Adobe Firefly Services — Creative Automation |
| **Requires**  | `adobe-firefly-core`                         |
| **Conflicts** | none                                         |
| **Branch**    | `feature/generator-template-adobe-indesign`  |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `InDesignPort` + `indesign` adapter with `dataMerge` (maps records from a data source
into a published `.indd` template), `renderLayout`, and `exportPdf`. Each presigns IO,
submits an async job, and resolves to a single output href.

## Service & API

- **Host:** `image.adobe.io` (same host family as Photoshop/Lightroom/Illustrator); posts
  **absolute URLs**.
- **Auth:** IMS Server-to-Server (inherited). **Wait:** centralised `jobPort.poll(handle)`.
- `exportPdf` **always** produces PDF, regardless of the default format.

## Install

`hexagen add adobe-indesign`. Questions:

| Question                   | Options (default)                                          |
| -------------------------- | ---------------------------------------------------------- |
| `operations` (multiselect) | `dataMerge`, `renderLayout`, `exportPdf` (`["dataMerge"]`) |
| `output_format`            | `pdf` / `jpg` / `png` (`pdf`) — `exportPdf` is always PDF  |

Env: `ADOBE_INDESIGN_BASE_URL`, `ADOBE_INDESIGN_FORMAT`. Emits `indesign.port.ts`,
`indesign.adapter.ts`, `.env.adobe-indesign.example`.

## Usage

```ts
import { indesign } from "@/infrastructure/adobe/indesign/indesign.adapter";

await indesign.dataMerge({
  inputHref: "s3://bucket/in/catalog.indd",
  dataHref: "s3://bucket/in/products.csv",
  outputHref: "s3://bucket/out/catalog.pdf",
});
await indesign.renderLayout({ inputHref, outputHref, format: "png" });
await indesign.exportPdf({ inputHref, outputHref }); // always PDF
```

## Configuration

| Env var                   | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `ADOBE_INDESIGN_BASE_URL` | host override (default `https://image.adobe.io`)           |
| `ADOBE_INDESIGN_FORMAT`   | install-set default output format (`exportPdf` ignores it) |

## Notes for agents

- `dataMerge` needs an extra presigned **data-source** href (`dataHref`) alongside the template.
- Provide presigned `.indd` template + output hrefs (core passthrough or a `storage-*` addon).

## Checklist (post-install)

Confirm the InDesign entitlement/scope; verify endpoints on `image.adobe.io`; supply
presigned template + output (+ data source for `dataMerge`); set the default format.
Optional SDK: `npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Same host family:
[`adobe-photoshop`](../adobe-photoshop), [`adobe-lightroom`](../adobe-lightroom),
[`adobe-illustrator`](../adobe-illustrator).
