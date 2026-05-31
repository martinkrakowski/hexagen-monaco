# Adobe Firefly — Azure Blob Presigned Storage (`adobe-firefly-storage-azure`)

> Registers an Azure Blob Storage presigner for the `adobe-firefly-core` storage seam, so every
> Firefly service can take plain blob names instead of pre-made SAS URLs.

|               |                                                                                     |
| ------------- | ----------------------------------------------------------------------------------- |
| **ID**        | `adobe-firefly-storage-azure`                                                       |
| **Category**  | Adobe Firefly Services — storage presigner                                          |
| **Requires**  | `adobe-firefly-core`                                                                |
| **Conflicts** | `adobe-firefly-storage-s3`, `adobe-firefly-storage-gcs` (one presigner per project) |
| **Branch**    | `feature/generator-template-adobe-firefly-storage-azure`                            |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Swaps the core passthrough presigner for an Azure-backed one via `setStoragePresigner()`. Inputs
get a **read** SAS URL, outputs a **create/write** SAS URL, both tagged `storage: "external"` for
the Adobe APIs. An `http(s)` ref is passed through unchanged. Infrastructure-only — no new domain port.

## Service & API

- **Provider:** Azure Blob Storage (`@azure/storage-blob`), SAS via `generateBlobSASQueryParameters`.
- **Signing (two modes):**
  - **Account key** — set `ADOBE_AZURE_STORAGE_KEY`; the SAS is signed locally (simplest off-Azure).
  - **Managed identity** — leave the key unset; the adapter uses `DefaultAzureCredential`
    (`@azure/identity`) to mint a **user-delegation** SAS. Nothing is hardcoded.

## Install

`hexagen add adobe-firefly-storage-azure`. Question:

| Question             | Options (default)                                                    |
| -------------------- | -------------------------------------------------------------------- |
| `url_expiry_seconds` | `300` / `900` / `3600` (`900`) — SAS lifetime (clamped to 1..604800) |

Env: `ADOBE_AZURE_STORAGE_ACCOUNT`, `ADOBE_AZURE_CONTAINER`, `ADOBE_AZURE_STORAGE_KEY` (optional),
`ADOBE_AZURE_PREFIX`. Emits `azure-blob-presign.adapter.ts` (`AzureBlobPresignStorageAdapter`),
`azure-register.ts`, `.env.adobe-storage-azure.example`.

## Usage

```ts
// Register ONCE at startup, before any Firefly service call:
import "@/infrastructure/adobe/storage/azure-register";

// Thereafter, pass blob names (not full URLs) as input/output refs:
await fireflyUpscale.upscale({
  inputHref: "in/small.png",
  outputHref: "out/large.png",
});
```

## Configuration

| Env var                       | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `ADOBE_AZURE_STORAGE_ACCOUNT` | storage account name (read at presign time)                        |
| `ADOBE_AZURE_CONTAINER`       | blob container                                                     |
| `ADOBE_AZURE_STORAGE_KEY`     | optional account key; unset → managed-identity user-delegation SAS |
| `ADOBE_AZURE_PREFIX`          | optional blob-name prefix (leading/trailing slashes normalised)    |

## Notes for agents

- **No `deps` field exists in manifests** — installing the SDKs is a checklist step:
  `npm install @azure/storage-blob @azure/identity`.
- **Managed-identity (keyless) signing** mints a _user-delegation_ SAS — grant the identity
  **Storage Blob Data Contributor** on the container and the account-level `generateUserDelegationKey`
  action, or `getUserDelegationKey` fails.
- Account/container/prefix are **read at presign time** (and the `BlobServiceClient` built lazily),
  so a `.env` loaded after `azure-register`'s side-effect import is honoured and startup stays
  crash-free. Refs reject `..` path traversal.
- Mutually exclusive with the S3/GCS presigners (declared `conflicts`).

## Checklist (post-install)

Install `@azure/storage-blob @azure/identity`; set account + container; choose account-key or
managed-identity signing (grant the identity Blob Data Contributor + `generateUserDelegationKey`
for keyless); import `azure-register` once at startup; pass blob names (not URLs) as refs.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core) (the storage seam). Alternatives:
[`adobe-firefly-storage-s3`](../adobe-firefly-storage-s3), [`adobe-firefly-storage-gcs`](../adobe-firefly-storage-gcs).
