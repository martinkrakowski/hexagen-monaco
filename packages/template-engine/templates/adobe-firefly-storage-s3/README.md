# Adobe Firefly — S3 Presigned Storage (`adobe-firefly-storage-s3`)

> Registers an Amazon S3 presigner for the `adobe-firefly-core` storage seam, so every
> Firefly service can take plain S3 keys instead of pre-made presigned URLs.

|               |                                                                                        |
| ------------- | -------------------------------------------------------------------------------------- |
| **ID**        | `adobe-firefly-storage-s3`                                                             |
| **Category**  | Adobe Firefly Services — storage presigner                                             |
| **Requires**  | `adobe-firefly-core`                                                                   |
| **Conflicts** | `adobe-firefly-storage-gcs`, `adobe-firefly-storage-azure` (one presigner per project) |
| **Branch**    | `feature/generator-template-adobe-firefly-storage-s3`                                  |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Swaps the core passthrough presigner for an S3-backed one via `setStoragePresigner()`.
Inputs get a presigned **GET** URL, outputs a presigned **PUT** URL, both tagged
`storage: "external"` for the Adobe APIs. An `http(s)` ref is passed through unchanged.
This is infrastructure-only — no new domain port.

## Service & API

- **Provider:** Amazon S3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`).
- Region + credentials use the standard AWS chain (IAM role on AWS infra, `AWS_*` locally).

## Install

`hexagen add adobe-firefly-storage-s3`. Question:

| Question             | Options (default)                                       |
| -------------------- | ------------------------------------------------------- |
| `url_expiry_seconds` | `300` / `900` / `3600` (`900`) — presigned-URL lifetime |

Env: `ADOBE_S3_BUCKET`, `ADOBE_S3_REGION`, `ADOBE_S3_PREFIX`. Emits
`s3-presign.adapter.ts` (`S3PresignStorageAdapter`), `s3-register.ts`,
`.env.adobe-storage-s3.example`.

## Usage

```ts
// Register ONCE at startup, before any Firefly service call:
import "@/infrastructure/adobe/storage/s3-register";

// Thereafter, pass S3 object keys (not full URLs) as input/output refs:
await fireflyUpscale.upscale({
  inputHref: "in/small.png",
  outputHref: "out/large.png",
});
```

## Configuration

| Env var           | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `ADOBE_S3_BUCKET` | bucket the presigner signs against                     |
| `ADOBE_S3_REGION` | leave unset on AWS infra (IAM role); set for local dev |
| `ADOBE_S3_PREFIX` | optional key prefix                                    |

## Notes for agents

- **No `deps` field exists in manifests** — installing the AWS SDK is a checklist step:
  `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`.
- Presigned URLs inherit the signer's permissions — grant `s3:GetObject` + `s3:PutObject`.
- Mutually exclusive with the GCS/Azure presigners (declared `conflicts`).

## Checklist (post-install)

Install the AWS SDK; set `ADOBE_S3_BUCKET` and grant `s3:GetObject`/`s3:PutObject`; import
`s3-register` once at startup; pass S3 keys (not URLs) as refs; use the AWS credential chain.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core) (the storage seam). Alternatives
(design-only): `adobe-firefly-storage-gcs`, `adobe-firefly-storage-azure`.
