# Adobe Creative Production API (`adobe-creative-production`)

> Map a published workflow over N assets in one async batch job, surfacing **per-asset
> status** — a failed asset is reported in-band rather than failing the whole batch.

|               |                                                        |
| ------------- | ------------------------------------------------------ |
| **ID**        | `adobe-creative-production`                            |
| **Category**  | Adobe Firefly Services — Creative Automation (batch)   |
| **Requires**  | `adobe-firefly-core`                                   |
| **Conflicts** | none                                                   |
| **Branch**    | `feature/generator-template-adobe-creative-production` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `CreativeProductionPort` + `creativeProduction` adapter. `runWorkflow(req)` presigns
each asset's input + output, submits **one** async batch job, and resolves to
**`AssetResult[]`** — a discriminated union per asset:

```ts
type AssetResult =
  | { id: string; status: "succeeded"; outputHref: string }
  | { id: string; status: "failed"; error: string };
```

The outer `Result` fails only on a batch-level error (submit / poll / count mismatch).

## Service & API

- **Host:** `image.adobe.io` host family (configurable via `ADOBE_CREATIVE_PRODUCTION_BASE_URL`);
  posts **absolute URLs**.
- **Auth:** IMS Server-to-Server (inherited). **Wait:** centralised `jobPort.poll(handle)`.
- Outputs are aligned **positionally** 1:1 with `req.assets` (a count mismatch is a
  batch-level error; a per-asset missing href is an in-band `"failed"`).

## Install

`hexagen add adobe-creative-production`. **No questions** — the workflow is chosen at
runtime, and outputs are workflow-defined (no format question).

Env: `ADOBE_CREATIVE_PRODUCTION_BASE_URL`. Emits `creative-production.port.ts`,
`creative-production.adapter.ts`, `.env.adobe-creative-production.example`.

## Usage

```ts
import { creativeProduction } from "@/infrastructure/adobe/creative-production/creative-production.adapter";

const res = await creativeProduction.runWorkflow({
  workflowId: "published-workflow-id",
  assets: [
    { id: "a1", inputHref: "s3://b/in/1.png", outputHref: "s3://b/out/1.png" },
    { id: "a2", inputHref: "s3://b/in/2.png", outputHref: "s3://b/out/2.png" },
  ],
});
if (res.success) {
  for (const a of res.value) {
    if (a.status === "succeeded") console.log(a.id, a.outputHref);
    else console.warn(a.id, a.error); // in-band failure
  }
}
```

## Configuration

| Env var                              | Purpose                                          |
| ------------------------------------ | ------------------------------------------------ |
| `ADOBE_CREATIVE_PRODUCTION_BASE_URL` | host override (default `https://image.adobe.io`) |

## Notes for agents

- **Partial success is the contract** — narrow on `status`; the compiler enforces
  `succeeded ⇒ outputHref`, `failed ⇒ error`.
- **Soft dependency:** persist the per-asset breakdown in your own store (e.g. `supabase`/DB)
  for long-running batches — the adapter returns it but does not persist it.
- Alignment is positional (`JobOutput` carries no id); the count guard is the integrity check.

## Checklist (post-install)

Confirm the Creative Production entitlement/scope; verify the host/path; supply a workflow id
plus presigned input+output per asset; persist batch status if needed. Pairs with
`adobe-express`. Optional SDK: `npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Sibling batch service:
[`adobe-express`](../adobe-express).
