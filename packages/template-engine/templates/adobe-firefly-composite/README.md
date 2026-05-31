# Adobe Firefly — Composite (`adobe-firefly-composite`)

> Composite Operations: blend a product image into a scene (matching tone, lighting,
> and shadow). Returns an array of candidate composites.

|               |                                                      |
| ------------- | ---------------------------------------------------- |
| **ID**        | `adobe-firefly-composite`                            |
| **Category**  | Adobe Firefly Services — Core Generative             |
| **Requires**  | `adobe-firefly-core`                                 |
| **Conflicts** | none                                                 |
| **Branch**    | `feature/generator-template-adobe-firefly-composite` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `CompositePort` + `fireflyComposite` adapter. `composite(req)` takes a product href
and a scene href, submits an async job, and resolves to **multiple candidate** output
hrefs (the model returns several blends to choose from).

## Service & API

- **Host:** `firefly-api.adobe.io` (via core). Posts to `/v3/images/composite-async`.
- **Auth:** IMS Server-to-Server (inherited). Resolves to **`string[]`** (candidates).

## Install

`hexagen add adobe-firefly-composite`. Question:

| Question             | Options (default)                                         |
| -------------------- | --------------------------------------------------------- |
| `default_candidates` | `1`–`4` (`2`) — number of candidate composites to request |

Env: `ADOBE_FIREFLY_DEFAULT_MODEL`, `ADOBE_COMPOSITE_CANDIDATES`. Emits `composite.port.ts`,
`composite.adapter.ts`, `.env.adobe-composite.example`.

## Usage

```ts
import { fireflyComposite } from "@/infrastructure/adobe/composite/composite.adapter";

const res = await fireflyComposite.composite({
  productHref: "s3://bucket/in/bottle.png",
  sceneHref: "s3://bucket/in/kitchen.jpg",
  outputHref: "s3://bucket/out/composite.png",
  numVariations: 3,
  prompt: "on a marble counter, morning light",
});
if (res.ok)
  res.value.forEach((href, i) => console.log(`candidate ${i}: ${href}`));
```

## Configuration

| Env var                       | Purpose                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `ADOBE_FIREFLY_DEFAULT_MODEL` | per-environment model override                             |
| `ADOBE_COMPOSITE_CANDIDATES`  | install-set default candidate count (also `numVariations`) |

## Notes for agents

- The port returns an **array** — callers pick a candidate.
- `contentCredentials` / `safety` are pass-through per-call options.
- Provide presigned product + scene + output hrefs (core passthrough or a `storage-*` addon).

## Checklist (post-install)

Confirm the Composite entitlement/scope; verify `/v3/images/composite-async`; supply
presigned product/scene/output hrefs; tune candidate count via env; set credentials/safety
per call. Optional SDK: `npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Sibling: [`adobe-firefly-generate`](../adobe-firefly-generate).
