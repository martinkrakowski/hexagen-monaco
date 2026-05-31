# Adobe Firefly Services — template family conventions

Author-facing notes for the `adobe-firefly-core` foundation and the service/storage
addons that build on it (`adobe-photoshop`, `adobe-lightroom`, `adobe-illustrator`,
`adobe-indesign`, `adobe-express`, `adobe-creative-production`, `adobe-substance-3d`,
`adobe-firefly-*`, `adobe-firefly-storage-*`). This file is **not** emitted into
generated projects — it lives beside `manifest.json`, outside `files/`.

These are settled, reviewed decisions. They recur as review flags; the entries below
are the resolution so they don't need re-litigating per PR.

## Polling: `jobPort.poll()`, not `pollJobStatus()`

Every `image.adobe.io` service adapter waits on its async job through the centralised
**`jobPort.poll(handle)`** seam — added in #152 and used by **all** service adapters
(photoshop, lightroom, illustrator, indesign, express, creative-production,
substance-3d). No adapter imports `pollJobStatus` directly.

Rationale: keeps the wait path on the outbound job port (instrumentation, timeouts,
mode-hiding live there) instead of reaching past it to the poller. `poll()` polls
without a max-wait cap, so long renders (e.g. Substance 3D) are not cut off.

A "some adapters still use `pollJobStatus`" diff is **stale** — that was the pre-#152
state. Verify with:

```
grep -rl "pollJobStatus(" templates/adobe-*/files/**/adapter.ts   # → no matches
```

## `branch` is a schema field

`"branch"` in every `manifest.json` is a **documented optional field** of the manifest
schema — see `src/domain/template-manifest.ts` (`branch?: string`, parsed in
`validateManifest`). It is the suggested implementation branch for the addon, not a
stale git artifact, and is intentionally present in all manifests.

## `image.adobe.io` adapter invariants

Shared by every service adapter on that host family:

- `// @hexagen-server-only` (ADR-0037) — the IMS token never leaves `infrastructure/adobe/**`.
- Posts **absolute URLs**; `normalizeBase()` guarantees scheme + lowercases it + strips
  the trailing slash. `fireflyClient` matches `https?://` case-insensitively (#150).
- **Status-URL-required guard**: `if (!handle.statusUrl) return err(...)` before polling —
  these services are tracked by a status URL and don't deliver Firefly webhooks.
- `done.outputs` is a non-optional `JobOutput[]` (`parseJobResult` always returns an
  array); a `JobOutput` is `{ href?, data? }` (no id — batch alignment is positional).
- Type-only `import type { FireflyError }` in domain ports — erased at compile, the
  deliberate domain→infra decoupling for the `Result<T, FireflyError>` failure channel.

## Tests

- `node:test` + **`node:assert/strict`** — the package-wide convention (every
  `*.test.ts` imports `node:assert/strict`, not bare `node:assert`).
- Emit-shape tests are string-matching against the emitted payload (the template files
  are scaffold content, not executable modules in this package), named
  `adobe-<service>-emit-shape.test.ts`.
- After adding/changing a template: regenerate wizard parity with
  `yarn workspace web gen:template-questions`.
