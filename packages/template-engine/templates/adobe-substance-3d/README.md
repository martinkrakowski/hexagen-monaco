# Adobe Substance 3D API (`adobe-substance-3d`)

> Compute-heavy 3D automation: render a scene to a 2D image, composite a render over a
> background plate, or relight a scene with a new environment. The longest-running Firefly jobs.

|               |                                                 |
| ------------- | ----------------------------------------------- |
| **ID**        | `adobe-substance-3d`                            |
| **Category**  | Adobe Firefly Services — Creative Automation    |
| **Requires**  | `adobe-firefly-core`                            |
| **Conflicts** | none                                            |
| **Branch**    | `feature/generator-template-adobe-substance-3d` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds `Substance3DPort` + `substance3d` adapter with `render`, `composite` (extra
`backgroundHref`), and `relight` (extra `environmentHref`, an HDRI). Each presigns IO,
submits an async job, and resolves to a single output href.

## Service & API

- **Host:** `image.adobe.io` host family (configurable via `ADOBE_SUBSTANCE_3D_BASE_URL`);
  posts **absolute URLs**.
- **Auth:** IMS Server-to-Server (inherited). **Wait:** centralised `jobPort.poll(handle)`,
  which polls with **no max-wait cap** so long renders aren't cut off.

## Install

`hexagen add adobe-substance-3d`. Questions:

| Question                   | Options (default)                               |
| -------------------------- | ----------------------------------------------- |
| `operations` (multiselect) | `render`, `composite`, `relight` (`["render"]`) |
| `output_format`            | `png` / `jpg` (`png`)                           |

Env: `ADOBE_SUBSTANCE_3D_BASE_URL`, `ADOBE_SUBSTANCE_3D_FORMAT`. Emits `substance-3d.port.ts`,
`substance-3d.adapter.ts`, `.env.adobe-substance-3d.example`.

## Usage

```ts
import { substance3d } from "@/infrastructure/adobe/substance-3d/substance-3d.adapter";

await substance3d.render({
  inputHref: "s3://b/in/scene.sbsar",
  outputHref: "s3://b/out/render.png",
});
await substance3d.composite({
  inputHref,
  outputHref,
  backgroundHref: "s3://b/in/plate.jpg",
});
await substance3d.relight({
  inputHref,
  outputHref,
  environmentHref: "s3://b/in/studio.hdr",
});
```

## Configuration

| Env var                       | Purpose                                          |
| ----------------------------- | ------------------------------------------------ |
| `ADOBE_SUBSTANCE_3D_BASE_URL` | host override (default `https://image.adobe.io`) |
| `ADOBE_SUBSTANCE_3D_FORMAT`   | install-set default output format (`png`/`jpg`)  |

## Notes for agents

- **Longest-running jobs.** These are polled by status URL regardless of `job_mode` —
  `image.adobe.io` services don't deliver Firefly webhooks, so webhook mode and
  `ADOBE_WEBHOOK_TIMEOUT_MS` don't apply here. `jobPort.poll()` has no max-wait cap, so a
  long render isn't cut off; raise `ADOBE_JOB_POLL_INTERVAL_MS` to throttle status checks.
  No new infra — these are existing `adobe-firefly-core` knobs.
- `composite`/`relight` each presign an extra input alongside the source asset.

## Checklist (post-install)

Confirm the Substance 3D entitlement/scope; verify the host/path; supply presigned scene +
output (+ background for composite, HDRI for relight); tune the long-running timeouts.
Optional SDK: `npm install @adobe/firefly-services-sdk-js`.

## Related

Foundation: [`adobe-firefly-core`](../adobe-firefly-core). Same host family:
[`adobe-photoshop`](../adobe-photoshop), [`adobe-illustrator`](../adobe-illustrator),
[`adobe-indesign`](../adobe-indesign).
