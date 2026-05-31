# Adobe Firefly — GCS Presigned Storage (`adobe-firefly-storage-gcs`)

> Registers a Google Cloud Storage presigner for the `adobe-firefly-core` storage seam, so every
> Firefly service can take plain GCS object names instead of pre-made presigned URLs.

|               |                                                                                       |
| ------------- | ------------------------------------------------------------------------------------- |
| **ID**        | `adobe-firefly-storage-gcs`                                                           |
| **Category**  | Adobe Firefly Services — storage presigner                                            |
| **Requires**  | `adobe-firefly-core`                                                                  |
| **Conflicts** | `adobe-firefly-storage-s3`, `adobe-firefly-storage-azure` (one presigner per project) |
| **Branch**    | `feature/generator-template-adobe-firefly-storage-gcs`                                |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Swaps the core passthrough presigner for a GCS-backed one via `setStoragePresigner()`. Inputs get
a **V4 read** signed URL, outputs a **V4 write** signed URL, both tagged `storage: "external"` for
the Adobe APIs. An `http(s)` ref is passed through unchanged. Infrastructure-only — no new domain port.

## Service & API

- **Provider:** Google Cloud Storage (`@google-cloud/storage`), V4 signed URLs (`getSignedUrl`).
- **Credentials:** the Google Application Default Credentials chain (`GOOGLE_APPLICATION_CREDENTIALS`
  locally; the attached service account on Cloud Run/GCE/GKE). Signing uses the SA private key, or
  the IAM SignBlob API when no key file is present. No region concept (GCS buckets are global-addressed).

## Install

`hexagen add adobe-firefly-storage-gcs`. Question:

| Question             | Options (default)                                                           |
| -------------------- | --------------------------------------------------------------------------- |
| `url_expiry_seconds` | `300` / `900` / `3600` (`900`) — signed-URL lifetime (clamped to 1..604800) |

Env: `ADOBE_GCS_BUCKET`, `ADOBE_GCS_PREFIX`. Emits `gcs-presign.adapter.ts`
(`GcsPresignStorageAdapter`), `gcs-register.ts`, `.env.adobe-storage-gcs.example`.

## Usage

```ts
// Register ONCE at startup, before any Firefly service call:
import "@/infrastructure/adobe/storage/gcs-register";

// Thereafter, pass GCS object names (not full URLs) as input/output refs:
await fireflyUpscale.upscale({
  inputHref: "in/small.png",
  outputHref: "out/large.png",
});
```

## Configuration

| Env var            | Purpose                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `ADOBE_GCS_BUCKET` | bucket the presigner signs against (validated at presign time, not import) |
| `ADOBE_GCS_PREFIX` | optional object-name prefix (leading/trailing slashes normalised)          |

## Notes for agents

- **No `deps` field exists in manifests** — installing the SDK is a checklist step:
  `npm install @google-cloud/storage`.
- **V4 signing without a key file** uses the IAM Credentials SignBlob API — grant the SA
  `roles/iam.serviceAccountTokenCreator` on itself and enable the IAM Credentials API.
- **Keyless signing (ADC without a key file — metadata server / Workload Identity) makes one
  SignBlob round-trip _per presigned URL_.** GCS signs each V4 URL
  individually — the signature is per-URL, so there's no reusable key to cache (unlike Azure's
  user-delegation key). Firefly adapters presign 2–3+ refs per request, so this is N control-plane
  calls per request in keyless mode. To sign **locally** with no per-URL calls, supply a
  service-account key file via `GOOGLE_APPLICATION_CREDENTIALS`.
- Bucket validation is **deferred to presign time** (`requireBucket`) so a missing bucket can't crash
  startup when `gcs-register` is imported. Refs reject `..` path traversal so they can't escape the prefix.
- Mutually exclusive with the S3/Azure presigners (declared `conflicts`).

## Checklist (post-install)

Install `@google-cloud/storage`; set `ADOBE_GCS_BUCKET` and grant the SA object viewer+creator (or
objectAdmin); provide ADC credentials; grant `serviceAccountTokenCreator` for keyless signing; import
`gcs-register` once at startup; pass object names (not URLs) as refs.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core) (the storage seam). Alternatives:
[`adobe-firefly-storage-s3`](../adobe-firefly-storage-s3); `adobe-firefly-storage-azure` (design-only).
