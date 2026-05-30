# Template Family: Adobe Firefly Services

**Branches:**

- `feature/generator-template-adobe-firefly-core` — foundation (auth, jobs, storage, errors)
- `feature/generator-template-adobe-firefly-<service>` — one per service addon (13, listed below)
- `feature/generator-template-adobe-firefly-storage-<provider>` — optional presign addons (s3 / gcs / azure)

## Purpose

Make a Hexagen project able to drive **Adobe Firefly Services** — Adobe's enterprise cloud API
suite for generative content and creative automation — from behind clean hexagonal ports,
without leaking Adobe SDKs, IMS tokens, or async-job plumbing into the application layer.

Firefly Services is not one API; it is ~13 REST services that **all share one foundation**:

| Shared concern       | Detail                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **Auth**             | Adobe IMS **OAuth Server-to-Server** (`client_credentials`) → short-lived bearer token + `x-api-key`    |
| **Job lifecycle**    | Most operations are **async**: `POST` returns a job, then poll a status URL **or** receive a webhook    |
| **External storage** | Inputs/outputs are passed as **presigned URLs** (`storage: "external"`) — never multipart through Adobe |
| **Errors**           | Uniform HTTP error surface (`401`/`403` auth, `429` throttle, `4xx` validation, `5xx` service)          |
| **Server-only**      | Every adapter holds a privileged token; none may reach a client bundle (ADR-0037)                       |

Because that foundation is identical across services, it ships **once** as `adobe-firefly-core`;
each service is a thin addon that `requires: ["adobe-firefly-core"]` and contributes a port +
adapter. This is the same template-splitting discipline used for `supabase`/`supabase-auth` and
the Bedrock AgentCore family (see [`16-bedrock-agentcore.md`](./16-bedrock-agentcore.md)).

---

## Scope decision

**In scope — the 13 Firefly _Services_ (API/cloud) surfaces:**

Core Generative: Firefly Generate, Custom Models, Composite Operations, Upscale, Audio/Video.
Creative Automation: Creative Production, Photoshop, Lightroom, Illustrator, InDesign, Express,
Substance 3D, Content Tagging.

**Out of scope — the consumer Creative Cloud web apps** ("Generate Image", "Edit Photo with AI",
"Create Boards", "Generate Talking Avatar", partner-model toggles, etc.). These are interactive
end-user products, not programmatic integration surfaces, so they have no place in a backend
scaffold. Where a consumer capability has an API equivalent it is covered by the matching service
(e.g. "Generate AI Video" → **Audio/Video API**; "Generate Image" → **Firefly Generate API**).

> **Endpoints are recorded as intent, not gospel.** Adobe versions and relocates these paths
> (`firefly-api.adobe.io/v3/...`, `image.adobe.io/...`). Each addon's first phase must verify the
> current path/payload against live Adobe docs before coding. The plan pins the _shape_
> (auth, async job, presigned IO), which is stable, not exact URLs.

---

## The Core Architectural Decision (read first)

Three engine constraints (confirmed in prior reviews) shape the whole family:

1. **No manifest `dependencies` field.** `TemplateManifest` (`domain/template-manifest.ts`) cannot
   install npm packages; `validateManifest` silently drops unknown keys. Any package
   (`@aws-sdk/client-s3`, an official Adobe SDK) is installed via a **checklist `npm install`**.
2. **Flat `{variable}` interpolation only** — no conditional blocks in a file
   (`engine-gated-outputs.md`). A file gated off cannot be statically imported elsewhere or the
   build breaks. So **a barrel/factory may only static-import files that are always emitted.**
3. **Server-only boundary (ADR-0037).** All `infrastructure/adobe/**` files carry
   `// @hexagen-server-only` and must never be imported from a client bundle — they hold the IMS
   token.

Consequences applied throughout:

- **Auth is Server-to-Server OAuth, not JWT.** Adobe retired the JWT/Service-Account flow; the
  foundation uses the IMS `client_credentials` token endpoint. `@adobe/jwt-auth` is **not** used.
- **Storage presign is split out, not gated inside core.** A gated `s3-presign.adapter.ts` that a
  core factory statically imports would hit constraint #2. Instead, core ships the
  `FireflyStoragePort` + a **passthrough default** (the caller supplies presigned hrefs), and each
  concrete provider is its own opt-in addon (`adobe-firefly-storage-s3` …) that registers via a
  seam. No build hazard, no `@aws-sdk/client-s3` forced on projects that bring their own URLs.
- **Service adapters reuse the core fetch client.** Firefly Services are plain REST, so addons
  default to the core HTTP client (zero extra deps). The optional official
  `@adobe/firefly-services-sdk-js` is mentioned per-addon as a checklist opt-in, never a hard dep.

> **Decision to confirm before coding:** job-completion transport — **webhook** (needs a public
> receiver route + signature verification) vs. **polling** (simpler, no inbound route, costs RPS).
> The foundation supports both behind `FireflyJobPort`; `job_mode` picks the default. Confirm
> which is the house default for generated projects.

---

# Foundation — `adobe-firefly-core`

**Branch:** `feature/generator-template-adobe-firefly-core`
**Requires:** `env-setup`, `error-handling`
**Soft deps:** `rate-limiting` (429 coordination), `observability` (job latency logging)

## Install-Time Questions

| ID                   | Prompt                                    | Type   | Options / Default                                 |
| -------------------- | ----------------------------------------- | ------ | ------------------------------------------------- |
| `ims_region`         | Adobe IMS region host?                    | select | `ims-na1` (default), `ims-eu1`                    |
| `job_mode`           | How do async jobs report completion?      | select | `polling` (default), `webhook`                    |
| `storage_mode`       | Presigned-URL storage for inputs/outputs? | select | `passthrough` (default, caller supplies), `addon` |
| `default_timeout_ms` | Per-request timeout (ms)?                 | select | `30000`, `60000` (default), `120000`              |
| `max_retries`        | Max retries on transient failure?         | select | `0`, `1`, `2` (default), `3`                      |

## Files Generated

```
src/domain/ports/out/
  firefly-auth.port.ts            # FireflyAuthPort: getAccessToken() (cached)
  firefly-job.port.ts             # FireflyJobPort: submit/await/status for async ops
  firefly-storage.port.ts         # FireflyStoragePort: presignInput()/presignOutput()
src/infrastructure/adobe/
  auth/
    ims-token-provider.adapter.ts # @hexagen-server-only: client_credentials → token, cache+refresh
  http/
    firefly-client.ts             # base client: injects x-api-key + bearer, retry, timeout
  jobs/
    job-poller.ts                 # polls status URL → succeeded | failed | running
    webhook-verifier.ts           # (job_mode=webhook) verifies inbound signature
    job-result.ts                 # typed { jobId, status, outputs[] } envelope (zod)
  storage/
    passthrough-storage.adapter.ts # default: returns caller-provided hrefs unchanged
  errors/
    firefly-errors.ts             # classifyAdobeError(): 401/403→Auth, 429→RateLimit, 4xx→Validation, 5xx→Service
  index.ts                        # server-only barrel (imports only always-emitted files)
.env.adobe.example
```

## Generated .env Variables

```env
# Adobe IMS — OAuth Server-to-Server (NOT JWT)
ADOBE_CLIENT_ID=
ADOBE_CLIENT_SECRET=
ADOBE_SCOPES=openid,AdobeID,firefly_api,ff_apis     # scope set depends on entitlements
ADOBE_IMS_ORG_ID=                                    # x-gw-ims-org-id on some services
ADOBE_IMS_HOST=ims-na1.adobelogin.com
ADOBE_FIREFLY_BASE_URL=https://firefly-api.adobe.io

# Async jobs
ADOBE_JOB_POLL_INTERVAL_MS=2000
ADOBE_WEBHOOK_SECRET=                                # only if job_mode=webhook
```

`check-env` (from `env-setup`) treats `ADOBE_CLIENT_ID` / `ADOBE_CLIENT_SECRET` as **required**
(unlike AWS-role auth, there is no ambient credential source for IMS S2S).

## Key Design Decisions

**Token caching.** `ims-token-provider.adapter.ts` exchanges `client_credentials` at
`https://{ADOBE_IMS_HOST}/ims/token/v3`, caches the token in memory until ~5 min before expiry,
and refreshes on demand. No token is ever returned to a caller outside `infrastructure/adobe/**`.

**One async contract.** `FireflyJobPort.await(jobId)` hides polling-vs-webhook: in `polling` mode
it drives `job-poller.ts`; in `webhook` mode it resolves a promise the webhook receiver completes.
Service adapters depend only on the port, so switching transport never touches a service adapter.

**Strict typing.** The repo is `strict: true`; every snippet below types its parameters explicitly
(e.g. `submit(req: GenerateRequest): Promise<JobHandle>`), no implicit `any`.

**Storage seam.** `FireflyStoragePort` default returns caller hrefs untouched (`passthrough`).
The `storage_mode=addon` answer signals that a `adobe-firefly-storage-*` addon will register a
real presigner; the registration seam keeps core free of `@aws-sdk/*`.

## Phases

1. **Auth.** IMS S2S token provider + cache; unit test for refresh-before-expiry and 401→re-auth.
2. **HTTP client.** Header injection, `withRetry`/timeout (reuse `llm-adapter` utils’ shape),
   `classifyAdobeError`. Test: 429 → `RateLimitError` honouring `Retry-After`.
3. **Job port + poller.** `submit`/`await`/`status`; poller backoff; terminal-state detection.
   Test: mocked status sequence `running→running→succeeded`.
4. **Webhook (gated `job_mode=webhook`).** Receiver + HMAC signature verify; reject bad signature.
5. **Storage port + passthrough + barrel.** Server-only `index.ts` exporting only always-emitted
   modules.

## Post-Install Checklist (Core)

```
✅ adobe-firefly-core installed

  1. Create an Adobe Developer Console project; add the Firefly Services / API entitlement.
  2. Generate OAuth Server-to-Server credentials; set ADOBE_CLIENT_ID / ADOBE_CLIENT_SECRET / ADOBE_SCOPES.
  3. (No JWT.) If migrating from a legacy Service-Account/JWT integration, switch to S2S — JWT is retired.
  4. Confirm your entitlement covers the specific service addons you install (scopes differ per service).
  5. If job_mode=webhook: expose the receiver route publicly and set ADOBE_WEBHOOK_SECRET.
  6. Smoke the token flow:  npx tsx src/infrastructure/adobe/auth/smoke-token.ts
```

---

# Storage presign addons (optional)

**Branches:** `…-adobe-firefly-storage-s3`, `…-storage-gcs`, `…-storage-azure`
**Requires:** `adobe-firefly-core`

Each emits one `infrastructure/adobe/storage/<provider>-presign.adapter.ts` implementing
`FireflyStoragePort` (presign GET for inputs, PUT for outputs) and **registers it via the core
seam** so `firefly-client`/services resolve it without a static import of a gated file.
Checklist carries the only dependency channel, e.g. `npm install @aws-sdk/client-s3`
(`@aws-sdk/s3-request-presigner`). Mutually exclusive (`conflicts` each other) — one presigner wins.

---

# Service Addons (13)

Every addon below: **Requires** `adobe-firefly-core` (and a storage presigner — core passthrough
or a storage addon — when it has file IO). Each contributes a domain port + an
`infrastructure/adobe/<service>/<service>.adapter.ts` that builds on `firefly-client` +
`FireflyJobPort`, plus a gated `.env.adobe-<service>.example` and a checklist line. **Sync** =
returns result inline; **Async** = returns a job awaited via `FireflyJobPort`.

### Core Generative

**1 · `adobe-firefly-generate`** — Firefly Generate API (flagship)
Async. Port `ImageGenerationPort`. Question `operations` (multiselect: `text-to-image`,
`generative-fill`, `generative-expand`, `image-to-image`, `style-transfer`; default
`text-to-image`). One adapter method per operation; fill/expand/i2i/style take presigned input
hrefs. Outputs written to presigned output hrefs. Env: `ADOBE_FIREFLY_DEFAULT_MODEL`
(e.g. image-model id), `ADOBE_FIREFLY_SIZE`. Notable: content-credentials / safety flags pass
through as options on the port, not hardcoded.

**2 · `adobe-firefly-custom-models`** — Custom Models API
Async, long-running, webhook-friendly. Port `CustomModelPort` (`train`, `status`, `list`,
`generateWith(modelId, …)`). Requires storage (dataset upload). Question
`dataset_caption_format` (`jsonl` default). Adapter: zip+upload dataset to presigned PUT → submit
train job → `FireflyJobPort.await` over `queued→training→completed`. Checklist: dataset of
10–50 curated brand images + JSONL captions; entitlement gate.

**3 · `adobe-firefly-composite`** — Composite Operations API
Async. Port `CompositePort.composite(productHref, sceneHref, opts)` → blended scene matching
tone/lighting/shadow. Requires storage. Notable: returns multiple candidate outputs; port returns
an array.

**4 · `adobe-firefly-upscale`** — Upscale API
Async. Port `UpscalePort.upscale(inputHref, { factor })`. Requires storage. Lightest service;
good first integration to validate the foundation end-to-end.

**5 · `adobe-firefly-media`** — Audio/Video API
Async, **long** jobs (minutes). Port `MediaGenerationPort` (`textToVideo`, `imageToVideo`,
`translateAudioVideo`, `generateSpeech`/`soundEffect`). Requires storage. Question `partner_model`
(off by default) acknowledging partner-model routing (Veo/Runway/Kling/ElevenLabs) where
entitled — kept as an opaque model id, no partner SDKs. Notable: poll interval scaled up;
webhook strongly recommended.

### Creative Automation

**6 · `adobe-creative-production`** — Creative Production API
Async **batch**. Port `CreativeProductionPort.runWorkflow(workflowId, assets[])` with batch
progress. Requires storage + a persistence store for batch status (soft dep `supabase`/DB).
Notable: maps a published workflow over N assets; surfaces per-asset status.

**7 · `adobe-photoshop`** — Photoshop API (`image.adobe.io/pie/psdService`)
Async. Port `PhotoshopAutomationPort` (`smartObject`, `editTextLayer`, `applyActionJson`,
`crop`, `renderPsd`). Requires storage. Question `operations` (multiselect). Notable: inputs are
named layers in a pre-authored `.psd`; checklist warns templates must have named Smart
Objects/text layers.

**8 · `adobe-lightroom`** — Lightroom API (`image.adobe.io/lrService`)
Async. Port `LightroomPort` (`autoTone`, `applyPreset`, `edit`). Requires storage. Batch-oriented
photo editing/color grading.

**9 · `adobe-illustrator`** — Illustrator API
Async. Port `IllustratorPort` (`renderArtboard`, `dataMerge`, `scaleVector`). Requires storage.
Notable: vector→raster at arbitrary scale (ads → billboards).

**10 · `adobe-indesign`** — InDesign API
Async. Port `InDesignPort` (`dataMerge`, `renderLayout`, `exportPdf`). Requires storage.
Question `output_format` (`pdf` default, `jpg`, `png`). Notable: template + data-source merge.

**11 · `adobe-express`** — Express API
Async batch. Port `ExpressAutomationPort.renderBatch(templateId, modifications[])`. Requires
storage. Notable: localization batch (translated copy/regional imagery) over a published Express
template; pairs naturally with `adobe-creative-production`.

**12 · `adobe-substance-3d`** — Substance 3D API
Async, compute-heavy. Port `Substance3DPort` (`render`, `composite`, `relight`). Requires storage.
Notable: longest-running; webhook + high timeout defaults.

**13 · `adobe-content-tagging`** — Content Tagging API
**Sync** (or short async). Port `ContentTaggingPort.tag(inputHref)` → structured tags/metadata.
Requires storage for input only (no large output). Notable: feeds search/personalization; the one
service whose result is JSON, not an asset — exercises the non-asset path of `FireflyJobPort`.

---

## Per-Addon Manifest Skeleton (applies to all 13)

```jsonc
{
  "id": "adobe-firefly-<service>",
  "requires": ["adobe-firefly-core"],
  "conflicts": [],
  "questions": [
    /* operations / format toggles as noted above */
  ],
  "envVars": ["ADOBE_<SERVICE>_*"],
  "outputs": [
    "src/domain/ports/out/<service>.port.ts",
    "src/infrastructure/adobe/<service>/<service>.adapter.ts",
    {
      "path": ".env.adobe-<service>.example",
      "when": { "answer": "operations", "includes": "<op>" },
    },
  ],
  "checklist": [
    "Confirm the <Service> entitlement + scope on your Developer Console project",
    "Verify the current endpoint/payload against Adobe docs (paths version frequently)",
    "Optional official SDK: npm install @adobe/firefly-services-sdk-js",
  ],
  "branch": "feature/generator-template-adobe-firefly-<service>",
}
```

Adapter sketch (strict-typed, server-only, foundation-driven) — identical shape across services:

```typescript
// src/infrastructure/adobe/upscale/upscale.adapter.ts  — @hexagen-server-only (ADR-0037)
import type {
  UpscalePort,
  UpscaleRequest,
} from "../../../domain/ports/out/upscale.port";
import { fireflyClient } from "../http/firefly-client";
import { jobPort } from "../jobs/job-port";
import { classifyAdobeError } from "../errors/firefly-errors";
import type { Result } from "../../../shared/result";

export class FireflyUpscaleAdapter implements UpscalePort {
  async upscale(req: UpscaleRequest): Promise<Result<string, FireflyError>> {
    try {
      const { jobId } = await fireflyClient.post("/v3/images/upscale", {
        image: { href: req.inputHref, storage: "external" },
        output: { href: req.outputHref, storage: "external" },
        factor: req.factor ?? 2,
      });
      const done = await jobPort.await(jobId); // polling or webhook, transparently
      return { success: true, value: done.outputs[0].href };
    } catch (e) {
      return { success: false, error: classifyAdobeError(e) };
    }
  }
}
```

---

## Dependency Graph (this family)

```
env-setup
└── error-handling
    └── adobe-firefly-core (IMS S2S auth · FireflyJobPort · FireflyStoragePort · classifyAdobeError)
        ├── adobe-firefly-storage-s3 | -gcs | -azure   (mutually exclusive presign addons)
        ├── adobe-firefly-generate
        ├── adobe-firefly-custom-models
        ├── adobe-firefly-composite
        ├── adobe-firefly-upscale
        ├── adobe-firefly-media
        ├── adobe-creative-production   (soft: a DB template for batch status)
        ├── adobe-photoshop
        ├── adobe-lightroom
        ├── adobe-illustrator
        ├── adobe-indesign
        ├── adobe-express
        ├── adobe-substance-3d
        └── adobe-content-tagging
```

Catalog placement: a new **Creative Content (Adobe Firefly)** section (the suite doesn't fit
`AI / Agents`, which is agent-orchestration). `adobe-firefly-core` is the section prerequisite,
mirroring how `env-setup` gates everything and `shared-types` gates the auth ecosystem.

---

## Cross-Cutting Risks & Open Questions

1. **Endpoint drift** — paths/payloads version frequently; each addon Phase 1 verifies against
   live docs. The plan pins the stable shape (S2S auth, async job, presigned IO), not URLs.
2. **Webhook vs polling default** — confirm the house default (`job_mode`); webhook needs a public
   route + signature verification, polling costs RPS on long jobs (media, substance).
3. **Entitlements are per-service** — a project may hold Firefly Generate but not Custom Models;
   installing an addon doesn't grant access. Checklists make this explicit; adapters surface
   `403` as a clear `EntitlementError`, not a stack trace.
4. **Storage hazard avoided by splitting** — presigners are addons (not gated-in-core files) to
   dodge the static-import-of-gated-file build break; `passthrough` is the zero-dependency default.
5. **No JWT** — do not scaffold `@adobe/jwt-auth`; it's the retired flow. S2S only.
6. **Long-running jobs** — media/substance can exceed serverless timeouts; if deployed on
   `docker`/AgentCore runtime, document worker/queue offload (soft dep `bullmq`).
7. **Token confinement** — `infrastructure/adobe/**` is `@hexagen-server-only`; a client-bundle
   import would leak the IMS token. Per-package ESLint (ADR-0037) must cover generated apps.
8. **Partner models** — the late-2025 partner-model toggles (OpenAI/Gemini/Veo/Runway/Kling/
   ElevenLabs) are surfaced only as opaque model ids on the media port; no partner SDKs are pulled
   and no partner auth is scaffolded in v1.

---

## Suggested Build Order

1. **`adobe-firefly-core`** — nothing works without auth + job + error foundation.
2. **`adobe-firefly-upscale`** — smallest real service; validates the whole foundation E2E.
3. **`adobe-firefly-storage-s3`** — unblocks every file-IO service for AWS-hosted projects.
4. **`adobe-firefly-generate`** — flagship; highest demand.
5. Remaining services in entitlement/demand order; **Custom Models** and **Media** last (webhook +
   long-job complexity); **Content Tagging** any time (exercises the sync/non-asset path).

Each template is independently shippable and independently valuable — the family's
compose-any-subset property holds.
