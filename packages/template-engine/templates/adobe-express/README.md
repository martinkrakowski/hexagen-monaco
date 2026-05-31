# Adobe Express API (`adobe-express`)

> The batch member of the family: render many variants from one published Express template
> in a single async batch job. The localization use case (translated copy + regional imagery
> per locale).

|               |                                                      |
| ------------- | ---------------------------------------------------- |
| **ID**        | `adobe-express`                                      |
| **Category**  | Adobe Firefly Services — Creative Automation (batch) |
| **Requires**  | `adobe-firefly-core`                                 |
| **Conflicts** | none                                                 |
| **Branch**    | `feature/generator-template-adobe-express`           |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `ExpressAutomationPort` + `expressAutomation` adapter. `renderBatch(req)` presigns each
variant's destination, submits **one** async batch job, and resolves to **`string[]`** — one
output href per `items[]` entry, in request order (all-or-nothing: a missing href fails the
batch). Singleton is named `expressAutomation` to avoid the Express.js `express` collision.

## Service & API

- **Host:** `image.adobe.io` host family (configurable via `ADOBE_EXPRESS_BASE_URL`); posts
  **absolute URLs**.
- **Auth:** IMS Server-to-Server (inherited). **Wait:** centralised `jobPort.poll(handle)`.
- Guards an empty `items[]` before spending a round-trip; validates output↔item count 1:1.

## Install

`hexagen add adobe-express`. Question:

| Question        | Options (default)                                      |
| --------------- | ------------------------------------------------------ |
| `output_format` | `jpg` / `png` / `pdf` (`jpg`) — default variant format |

Env: `ADOBE_EXPRESS_BASE_URL`, `ADOBE_EXPRESS_FORMAT`. Emits `express.port.ts`,
`express.adapter.ts`, `.env.adobe-express.example`.

## Usage

```ts
import { expressAutomation } from "@/infrastructure/adobe/express/express.adapter";

const res = await expressAutomation.renderBatch({
  templateId: "published-express-template-id",
  items: [
    {
      modifications: [{ key: "headline", value: "Bonjour" }],
      outputHref: "s3://b/out/fr.jpg",
    },
    {
      modifications: [{ key: "headline", value: "Hola" }],
      outputHref: "s3://b/out/es.jpg",
    },
  ],
});
if (res.success) res.value.forEach((href) => console.log(href)); // one per item, in order
```

## Configuration

| Env var                  | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `ADOBE_EXPRESS_BASE_URL` | host override (default `https://image.adobe.io`) |
| `ADOBE_EXPRESS_FORMAT`   | install-set default variant format               |

## Notes for agents

- **All-or-nothing batch:** any missing output href fails the whole `Result`. (Contrast with
  [`adobe-creative-production`](../adobe-creative-production), which reports per-asset status.)
- Asset-valued modifications are presigned **input** hrefs supplied by the caller.

## Checklist (post-install)

Confirm the Express entitlement/scope; verify the host/path; supply a published template id
plus a presigned output href per variant; one `items[]` entry per locale. Pairs with
`adobe-creative-production`. Optional SDK: `npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Sibling batch service:
[`adobe-creative-production`](../adobe-creative-production).
