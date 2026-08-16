# Adobe Firefly Services — Core (`adobe-firefly-core`)

> Shared foundation every Adobe Firefly Services addon builds on: IMS auth, a base
> REST client, the async job port, a presigned-URL storage seam, and Adobe error
> classification. Install this once; each service addon adds one port + adapter.

|               |                                                 |
| ------------- | ----------------------------------------------- |
| **ID**        | `adobe-firefly-core`                            |
| **Category**  | Adobe Firefly Services — foundation             |
| **Requires**  | `env-setup`, `error-handling`                   |
| **Conflicts** | none                                            |
| **Branch**    | `feature/generator-template-adobe-firefly-core` |

This README is author/agent-facing reference for the template itself. It is **not**
emitted into generated projects — it lives beside `manifest.json`, outside `files/`.

## What it does

Scaffolds the `infrastructure/adobe/**` foundation plus three outbound domain ports.
It owns the cross-cutting concerns so each service addon is just one port + one
adapter:

- **`FireflyAuthPort` / `imsTokenProvider`** — IMS OAuth **Server-to-Server**
  (`client_credentials`) token provider, cached in memory until ~5 min before expiry.
- **`fireflyClient`** — base REST client: injects `Authorization: Bearer` + `x-api-key`,
  applies timeout + bounded retry, and posts **absolute URLs** unchanged (case-insensitive
  `https?://` detection) so service addons on other hosts reuse it.
- **`FireflyJobPort` / `jobPort`** — async job seam. `await()` (jobId-only, webhook mode),
  `status()` (single read), and `poll()` (the centralised always-poll entry point used by
  every `image.adobe.io` service). Polling has no max-wait cap.
- **`FireflyStoragePort`** — presigned-URL seam. `passthrough` default (you supply hrefs);
  `setStoragePresigner()` / `getStoragePresigner()` let a `adobe-firefly-storage-*` addon
  swap in S3/GCS/Azure.
- **`classifyAdobeError` + the `FireflyError` hierarchy** — maps Adobe failures onto typed
  errors; services return `Result<T, FireflyError>`.

## Service & API

- **Provider:** Adobe Firefly Services. **Host:** `firefly-api.adobe.io` (default
  `ADOBE_FIREFLY_BASE_URL`); service addons may target other hosts (e.g. `image.adobe.io`).
- **Auth:** IMS OAuth Server-to-Server via `https://{ADOBE_IMS_HOST}/ims/token/v3`
  (`ims-na1` / `ims-eu1`). **Not** the retired JWT / `@adobe/jwt-auth` flow.
- **Jobs:** async; submit returns a job handle (`jobId` + optional `statusUrl`) resolved by
  polling or a webhook receiver (gated `job_mode=webhook`).

## Install

Run via `hexagen add adobe-firefly-core`. Questions:

| Question             | Options (default)                       | Effect                                                                       |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `ims_region`         | `ims-na1` / `ims-eu1` (`ims-na1`)       | IMS host region                                                              |
| `job_mode`           | `polling` / `webhook` (`polling`)       | how async jobs report completion; `webhook` also emits `webhook-verifier.ts` |
| `storage_mode`       | `passthrough` / `addon` (`passthrough`) | presigned-URL strategy                                                       |
| `default_timeout_ms` | `30000` / `60000` / `120000` (`60000`)  | per-request timeout                                                          |
| `max_retries`        | `0`–`3` (`2`)                           | retries on transient failure                                                 |

Env vars introduced: `ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET`, `ADOBE_SCOPES`,
`ADOBE_IMS_ORG_ID`, `ADOBE_IMS_HOST`, `ADOBE_FIREFLY_BASE_URL`,
`ADOBE_JOB_POLL_INTERVAL_MS`, `ADOBE_WEBHOOK_SECRET`.

Key emitted files: the three ports under `src/domain/ports/out/`, the adapters under
`src/infrastructure/adobe/{auth,http,jobs,storage,errors}/`, the `index.ts` barrel, and
`.env.adobe.example`.

## Usage

```ts
// A service addon's adapter composes the core pieces:
import { fireflyClient } from "@/infrastructure/adobe/http/firefly-client";
import { jobPort } from "@/infrastructure/adobe/jobs/job-port";
import { toJobHandle } from "@/infrastructure/adobe/jobs/job-result";
import { getStoragePresigner } from "@/infrastructure/adobe/storage/passthrough-storage.adapter";

const out = await getStoragePresigner().presignOutput(outputRef);
const handle = toJobHandle(await fireflyClient.post("/v3/...", body));
const done = await jobPort.poll(handle); // → JobResult { status, outputs: JobOutput[], ... }
```

Smoke-test the token flow without any service call:

```bash
npx tsx src/infrastructure/adobe/auth/smoke-token.ts
```

## Configuration

| Env var                                   | Purpose                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `ADOBE_CLIENT_ID` / `ADOBE_CLIENT_SECRET` | Server-to-Server OAuth credentials                                 |
| `ADOBE_SCOPES`                            | space/comma-separated scopes (per entitlement)                     |
| `ADOBE_IMS_ORG_ID`                        | IMS org id                                                         |
| `ADOBE_IMS_HOST`                          | e.g. `ims-na1.adobelogin.com`                                      |
| `ADOBE_FIREFLY_BASE_URL`                  | default `https://firefly-api.adobe.io`                             |
| `ADOBE_JOB_POLL_INTERVAL_MS`              | poll backoff base (default 2000)                                   |
| `ADOBE_WEBHOOK_SECRET`                    | required in `job_mode=webhook` (verifier fails closed without it)  |
| `ADOBE_WEBHOOK_TIMEOUT_MS`                | webhook-mode await timeout in ms (read at runtime, default 600000) |

## Notes for agents

- **Server-only boundary (ADR-0037).** `infrastructure/adobe/**` is `@hexagen-server-only` —
  the IMS token must never reach a client bundle.
- **Server-to-Server only.** Do not reintroduce JWT / `@adobe/jwt-auth`.
- **Webhook mode parks completion promises in memory** — correct for a single long-lived
  instance only. On serverless/multi-instance, use polling or back the registry with a
  shared store (Redis/BullMQ, Postgres).
- In `job_mode=webhook`, `await()` times out after `ADOBE_WEBHOOK_TIMEOUT_MS` (default 600000).
  This applies only to the webhook-delivering `firefly-api.adobe.io` services (generate / upscale
  / composite / content-tagging). The `image.adobe.io` services (photoshop … substance-3d) always
  poll by status URL — webhook mode doesn't apply; throttle them with `ADOBE_JOB_POLL_INTERVAL_MS`.
- `done.outputs` is always a `JobOutput[]` (`{ href?, data? }`); `parseJobResult` is total
  (never throws). There is no per-output id — batch services align positionally.

### Family conventions (apply to every Adobe Firefly addon)

- **Polling:** all `image.adobe.io` service adapters wait via the centralised
  **`jobPort.poll(handle)`** seam (added in #152). No adapter imports `pollJobStatus`
  directly. A "some still use `pollJobStatus`" diff is the stale pre-#152 state — verify:
  `grep -rl "pollJobStatus(" templates/adobe-*/files` → no matches.
- **`branch`** is a documented optional field of the manifest schema
  (`src/domain/template-manifest.ts`, `branch?: string`), intentionally present in every
  manifest — not a stale git artifact.
- **`image.adobe.io` adapter invariants:** `@hexagen-server-only`; absolute URLs via
  `normalizeBase()` (scheme lowercased, trailing slash stripped); status-URL-required guard
  before polling; type-only `import type { FireflyError }` in domain ports.
- **Tests:** Vitest + **`node:assert/strict`** (package-wide convention); emit-shape
  tests string-match the payload and are named `adobe-<service>-emit-shape.test.ts`.

## Checklist (post-install)

1. Create an Adobe Developer Console project; add the Firefly Services / API entitlement.
2. Generate OAuth Server-to-Server credentials; set `ADOBE_CLIENT_ID` / `ADOBE_CLIENT_SECRET` / `ADOBE_SCOPES`.
3. Do **not** use JWT — the Service-Account/JWT flow is retired.
4. Confirm your entitlement covers the specific service addons you install (scopes differ per service).
5. If `job_mode=webhook`: expose the receiver route publicly and set `ADOBE_WEBHOOK_SECRET`.
6. Webhook mode parks promises in memory — use polling on serverless/multi-instance.
7. Smoke the token flow: `npx tsx src/infrastructure/adobe/auth/smoke-token.ts`.
8. `infrastructure/adobe/**` is `@hexagen-server-only` — never import from a client bundle.

## Related

Service addons: [`adobe-firefly-generate`](../adobe-firefly-generate), [`adobe-firefly-upscale`](../adobe-firefly-upscale),
[`adobe-firefly-composite`](../adobe-firefly-composite), [`adobe-firefly-content-tagging`](../adobe-firefly-content-tagging),
[`adobe-photoshop`](../adobe-photoshop), [`adobe-lightroom`](../adobe-lightroom), [`adobe-illustrator`](../adobe-illustrator),
[`adobe-indesign`](../adobe-indesign), [`adobe-express`](../adobe-express), [`adobe-creative-production`](../adobe-creative-production),
[`adobe-substance-3d`](../adobe-substance-3d). Storage: [`adobe-firefly-storage-s3`](../adobe-firefly-storage-s3).
