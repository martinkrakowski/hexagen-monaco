# Adobe Firefly — Custom Models (`adobe-firefly-custom-models`)

> Train a brand-tuned model from a curated dataset, check status, list models, and generate with a
> trained model. Training is the longest operation in the family (minutes–hours).

|               |                                                          |
| ------------- | -------------------------------------------------------- |
| **ID**        | `adobe-firefly-custom-models`                            |
| **Category**  | Adobe Firefly Services — Core Generative                 |
| **Requires**  | `adobe-firefly-core`                                     |
| **Conflicts** | none                                                     |
| **Branch**    | `feature/generator-template-adobe-firefly-custom-models` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `CustomModelPort` + `fireflyCustomModel` adapter with the full lifecycle:

- **`train(req)`** — presigns the dataset, submits a training job, awaits `queued → training →
completed`, and resolves to the **trained model id**.
- **`status(modelId)`** — fetches a model's current `TrainedModel` (status + name).
- **`list()`** — lists the project's custom models.
- **`generateWith(req)`** — runs inference with a trained model id; resolves to output href(s).

## Service & API

- **Host:** `firefly-api.adobe.io` (the core `ADOBE_FIREFLY_BASE_URL`). Relative paths:
  `POST /v3/custom-models/train-async`, `POST /v3/images/generate-async`,
  `GET /v3/custom-models[/{id}]`.
- **Auth:** IMS Server-to-Server (inherited from core).
- **Wait:** `jobPort.await(handle)` — polling **or** webhook, transparently (the firefly-api job
  path, with a `jobId` guard) — not the always-poll other-host path.

## Install

`hexagen add adobe-firefly-custom-models`. Question:

| Question                 | Options (default)         |
| ------------------------ | ------------------------- |
| `dataset_caption_format` | `jsonl` / `csv` (`jsonl`) |

Env: `ADOBE_FIREFLY_BASE_MODEL`. Emits `custom-model.port.ts`, `firefly-custom-model.adapter.ts`,
`.env.adobe-custom-models.example`.

## Usage

```ts
import { fireflyCustomModel } from "@/infrastructure/adobe/custom-models/firefly-custom-model.adapter";

// Long-running — prefer webhook job_mode.
const trained = await fireflyCustomModel.train({
  name: "acme-brand",
  datasetHref: "s3://b/datasets/acme.zip", // 10–50 curated images + JSONL captions
});
if (!trained.success) throw trained.error;
const modelId = trained.value;

await fireflyCustomModel.status(modelId);
await fireflyCustomModel.list();

const res = await fireflyCustomModel.generateWith({
  modelId,
  prompt: "a hero shot of the flagship product",
  outputHref: "s3://b/out/hero.png",
  numVariations: 2,
});
```

## Configuration

| Env var                    | Purpose                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `ADOBE_FIREFLY_BASE_MODEL` | base model to fine-tune from (override per train via `baseModel`) |

## Notes for agents

- **Per-service entitlement.** Custom Models is a separate entitlement from Firefly Generate.
- **Longest job in the family** (minutes–hours): firefly-api is webhook-delivering, so
  `ADOBE_WEBHOOK_TIMEOUT_MS` applies — prefer `job_mode=webhook`; if polling, raise
  `ADOBE_JOB_POLL_INTERVAL_MS`.
- `train` reads the model id from the **completed job result** (`data`, via `parseJobResult`) — verify
  the field name against Adobe docs.
- Upload the dataset (zip of images + `dataset_caption_format` captions) to storage yourself and pass
  the ref; presign via core passthrough or a `storage-*` addon.

## Checklist (post-install)

Confirm the Custom Models entitlement; verify the `/v3/custom-models/*` + `/v3/images/generate-async`
endpoints; prepare + upload a 10–50 image dataset with captions; tune webhook/poll timeouts for the
long training job; pass `train()`'s model id to `generateWith()`/`status()`; set the base model.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Sibling Core Generative services:
[`adobe-firefly-generate`](../adobe-firefly-generate), [`adobe-firefly-media`](../adobe-firefly-media).
