# Surface Add-On Materialization Warnings & Errors (PR 3)

**Status:** Approved — A1 locked; ready for PR 3a
**Date:** 2026-06-04
**Parent:** `hydrate-code-view-with-addon-templates.md` (overall plan, Phase 3) · builds on the merged series **#211 → #212 → #213 → #214 → #215**

## Goal

Make the add-on materialization **`warnings`** (a template overrode a generated file) and **`errors`** (an unknown / conflicting / cyclic add-on selection — add-ons omitted, core project still shipped) **visible to the user** across the code view, the ZIP download, and the GitHub publish — instead of only being logged to server telemetry as they are today.

## Grounding — what actually happens now

`GenerateProjectUseCase.execute()` already returns `{ project, …, warnings?, errors? }`. From there the three sinks diverge:

| Path                              | Response                                  | Carries `warnings`/`errors` today?                 | Gap                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/generate` (JSON, code view) | `{ success, files, warnings?, errors? }`  | **Yes** — route reads them off the use-case result | Reaches the client (`ExportContext`) but **nothing renders them**.                                                                                                                |
| `/api/export/github` (JSON)       | `{ success, destinationUrl, githubLink }` | **No**                                             | `InitiateExportUseCase` maps the result to `ExportValue` (`GitHubExportValue = ExportResult`), which has **no** warnings/errors field — dropped in the use case before the route. |
| `/api/export/zip` (binary)        | `application/zip` blob                    | **No**                                             | Same use-case drop, **plus** a binary body that can't carry a JSON `warnings`/`errors` payload at all.                                                                            |

So there are **two distinct gaps**: a **data-flow** gap (the export use case discards the channel) and a **transport** gap (the ZIP response is binary). The code-view path has neither — it just lacks UI.

**Client surfaces (corrected after tracing the consumers).** The notices-bearing `/api/generate` JSON is consumed by `features/code-view/hooks/useProjectGeneration.ts` (the code view) — which reads `data.files` and currently **discards `data.warnings`/`data.errors`**. `ExportContext`'s status strip (`ExportStatusStrip`) handles **only** the ZIP path (GitHub is owned by `ExportDialog`), and the ZIP response is **binary** — so the strip never receives notices in its payload. The real surfaces are therefore: the **code view** (primary), the **GitHub `ExportDialog`**, and a **header-bridged cue** on the ZIP strip (not the strip-as-primary the first draft assumed).

## Decision A — how to surface on the binary ZIP path _(resolved: A1)_

This is the product call flagged during the #214 review. `errors`/`warnings` can't ride along in a binary download. Options:

| Option                                                     | Mechanism                                                                                                                                                                                                                                                                    | Pros                                                                                                                                                                                                                       | Cons                                                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1 (recommended)** — sidecar for errors, UI for warnings | When `errors` is non-empty, write a `HEXAGEN-ADDON-NOTICES.md` into the project root (in the use case, into `tempDir` before export) explaining which add-ons were omitted and why. `warnings` (override notices) surface in the **UI status strip** only, not the artifact. | Works uniformly for ZIP **and** GitHub (both read `tempDir`); a downloader who never opens the app still learns _why_ their selected add-ons are missing; doesn't clutter the project with informational override notices. | Injects one file into the output when a selection was bad (user can delete it).                                                                   |
| **A2** — header                                            | Return `errors`/`warnings` in an `X-Hexagen-Notices` response header on the ZIP.                                                                                                                                                                                             | No file injected.                                                                                                                                                                                                          | Headers are invisible unless the client reads them; lost once the file is on disk; size limits.                                                   |
| **A3** — block on errors                                   | If `errors` non-empty, return **400 JSON** (no zip) so the user must fix the selection first.                                                                                                                                                                                | Forces correctness.                                                                                                                                                                                                        | Contradicts the established "core project still offered" contract (#214); the user can't get the valid core ZIP because of a bad _add-on_ choice. |

**Resolved: A1** (reviewed and approved). It's the only option that surfaces the reason in the artifact itself (the ZIP/GitHub consumer may never be looking at the app), it reuses the existing temp-dir-before-export merge point, and it keeps warnings (informational) out of the deliverable. Errors are rare (bad selection through the UI shouldn't normally happen), so the sidecar appears only in the exceptional case.

## Steps

### PR 3a — close the data-flow gap (`@hexagen/project-generation` + web routes) — **backend**

1. **Thread the channel through export.** Extend `ExportValue` (or add a sibling field on the `InitiateExport` result) with `warnings?: string[]; errors?: string[]`, and have `InitiateExportUseCase.initiateExport` copy them from `result.value`. This unblocks `/api/export/github` to return them in its JSON.
2. **Sidecar (per Decision A1).** In `GenerateProjectUseCase` (or a thin helper), when `errors` is non-empty, write `HEXAGEN-ADDON-NOTICES.md` into `tempDir` **before** `export` so both ZIP and GitHub capture it; also `project.files.set(...)` it so the code view shows it. Reuse the containment-safe write path. (Warnings do **not** get a sidecar.)
3. **Surface on the routes.** `/api/export/github`: include `warnings`/`errors` in the JSON. `/api/export/zip`: the sidecar is the surfacing mechanism (binary body unchanged). `/api/generate`: already returns them — no change.
4. **Tests:** export use case carries `warnings`/`errors` out; a bad selection writes the sidecar into `tempDir` (asserted via the recording exporter) and into `project.files`; warnings do **not** write a sidecar; empty `addOnsAnswers` → no sidecar, byte-identical output.

### PR 3b — render them (`apps/web`) — **UI**

Surfaces corrected to where the notices actually arrive (not the ZIP-only strip):

5. **Code view (primary).** `useProjectGeneration.ts` reads `warnings`/`errors` off the `/api/generate` JSON and exposes a `notices` value (today they're dropped after `data.files`). The code-view component renders a **notices bar** with the severity design below.
6. **Severity design (all existing, Tailwind-mapped tokens).** 🟢 `success` (`CheckCircle2`) = clean; 🟡 `warning` (amber, `AlertTriangle`) = generated **with add-on errors** (project shipped, add-ons omitted → "see `HEXAGEN-ADDON-NOTICES.md`") — amber, _not_ red, since generation succeeded; 🔴 `destructive` (`AlertCircle`) = generation/export **failed**. Warnings (overrides) are a **muted count**, never escalated; errors drive the amber tone. Explicit `X` dismiss; **auto-dismiss suppressed when notices are present**.
7. **GitHub `ExportDialog`.** The github result carries notices (PR 3a) → render them on the publish-result view (parity for the push-to-repo path).
8. **ZIP strip cue (header bridge).** `/api/export/zip` has the notices on `ZipExportValue` (3a) but returns a **binary** body, so it emits the notice **counts in a response header**; `postForBlob` surfaces the header; `exportZip` sets an amber `success` state ("ZIP downloaded — notices written to `HEXAGEN-ADDON-NOTICES.md`"). The header is the _correct_ source — the ZIP export is its own server generation, not the code view's, so bridging from the code-view hook's state could show stale notices. `ExportState.success` gains a `notices` field.
9. **Optional — Monaco badges.** A subtle amber dot on overridden files (the `warnings` name each `rel`); kept low-noise. Deferrable to a fast-follow.
10. **Tests:** `useProjectGeneration` surfaces notices; the bar distinguishes errors vs warnings; the ZIP header round-trips to the amber strip; no notices → every surface unchanged from today.

## Decisions

Carried from the overall plan: warnings/errors are already collected + telemetry-logged (deduped per run); template-overrides-core; all three outputs.

New for PR 3:

- **Errors → artifact sidecar (A1); warnings → UI only.** Errors explain _omitted_ add-ons (must be discoverable offline); warnings are informational and belong in the app. _(Resolved — A1 approved.)_
- **`ExportValue` gains the notices channel** so the export use case stops discarding it — symmetry with the `/api/generate` path.
- **No new response contract for ZIP** — the binary download is unchanged; its notices ride in the sidecar.

## Risks

- **Scope creep into the editor.** The optional Monaco badges (step 9) touch the editor layer; keep them deferrable so the core surfacing (code-view bar + dialog + ZIP cue) lands first.
- **Sidecar surprise.** A file appearing in the project could confuse a user; mitigate with a clear, self-describing filename + a one-line "safe to delete" header. Only on `errors`, never on warnings.
- **Notices duplication.** The same dedup already applied for telemetry (per-run, by message) should apply to what the UI renders — reuse it, don't re-collect.

## Out of scope

- Changing the 200-vs-400 contract for bad selections (settled in #214: core still ships).
- Tightening templates that emit into `domain/` (separate follow-up).
- Persisting `addOnsAnswers` with the saved project so exports don't depend on the client re-sending `wizardData` (separate small follow-up; orthogonal to surfacing).

## Suggested split

- **PR 3a** — data-flow + sidecar + route surfacing + tests (backend; no UI). Self-contained and shippable.
- **PR 3b** — code-view notices bar (primary) + GitHub `ExportDialog` notices + ZIP strip header-cue + `ExportState` notices + tests (UI); optional Monaco badges. Depends on 3a (#217).
