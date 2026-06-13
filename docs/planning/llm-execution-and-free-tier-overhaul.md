# LLM Execution & Free-Tier UX Overhaul

**Status:** PR-1–PR-5 shipped · PR-6 next · **Created:** 2026-06-10 · **Owner:** Martin

## Motivation

Two incidents drove this plan, both on 2026-06-10 (post mercury-2 prod flip):

1. **The 5-minute import.** A spec import that the server completed in **16.5s**
   (replayed and measured per-stage against prod) presented as a ~5-minute
   generation in the browser. Root cause: `resolveExecutionStrategy`'s `auto`
   mode prefers a loaded local WebLLM model over cloud
   (`useStagedSpecGeneration.ts`), and on local failure it **silently** falls
   back to cloud. The user waited through a doomed in-browser run with no
   indication any of it was happening.
2. **No generation observability.** Diagnosing the above required replaying
   the request, because neither route logs per-stage activity server-side and
   the telemetry stream carries no model identity. With the mercury → gpt-4o
   stage-1 cascade live, "which model produced this?" is no longer answerable
   from the UI or the logs.

Alongside these, three pieces of pre-mercury UX are now stale: tandem mode
(superseded by the server-side cascade), the free-tier model strategy (slow
endpoint as implicit throttle), and a duplicated manifest-approval screen.

## PR sequence

| PR   | Title                                          | Size         | Depends on           | Status            |
| ---- | ---------------------------------------------- | ------------ | -------------------- | ----------------- |
| PR-1 | Cloud-first `auto` strategy + honest fallback  | S            | —                    | done (#305)       |
| PR-2 | Model identity in generation telemetry         | M            | —                    | done (#306)       |
| PR-3 | Explicit local override + pre-generate warning | M            | PR-1                 | done (#307)       |
| PR-4 | Remove the first approve-manifest screen       | M            | —                    | done (#308, #309) |
| PR-5 | Tandem mode removal                            | L (deletion) | #303 merge           | done (#310, #311) |
| PR-6 | Free-tier provider swap + in-app quotas        | L            | decisions below      | planned           |
| PR-7 | FreeTierModal UI refactor                      | M            | PR-6 + HTML template | blocked           |

PR-1 → PR-3 are one arc (strategy semantics, then override UX). PR-2, PR-4,
PR-5 are independent and can interleave. PR-6 → PR-7 are the free-tier arc.

---

## PR-1 — Cloud-first `auto` strategy + honest fallback

**Problem:** `auto` resolves to local whenever a WebLLM model happens to be
loaded, even though cloud (mercury-2) completes the same job ~18× faster; the
local→cloud fallback is invisible.

**Changes**

- `apps/web/features/manifest-generation/useStagedSpecGeneration.ts` —
  `resolveExecutionStrategy`: `auto` prefers **cloud** when `hasCloudKeys`,
  local only as fallback. Single flip point: `useLooseSpecConversion.ts`
  imports the same function.
- Engine-selection honesty: verbose-log chunk at resolution time
  ("Generating via cloud" / "Generating locally on the loaded model") and at
  both silent-fallback sites ("Local generation failed — retrying via cloud").
  Same for the conversion hook's `progressMessage`.
- Tests: flip the `auto: prioritizes local` case in
  `__tests__/useStagedSpecGeneration.test.ts`; assert fallback messaging.

**Risk:** minimal; client-only, no server change.

## PR-2 — Model identity in generation telemetry

**Problem:** `StageTelemetry` (packages/agentic-interaction,
`domain/value-objects/stage-telemetry.ts`) has tokens/retries/cache but no
model identity; the `/generate/spec` route forwards **no** telemetry events at
all; nothing is logged server-side per stage.

**Changes**

1. **Domain:** `StageTelemetry` gains `modelName: string` and
   `refinerModelName?: string` (stage-1 cascade). Display format:
   `[mercury-2]`, cascade: `[mercury-2 / gpt-4o]`.
2. **Truthful source:** populate from the **actual response metadata**
   (OpenAI-compatible responses carry `model`) captured by the adapter, so the
   label stays correct under provider fallback. Configured chain-head label
   only when the response omits it.
3. **NDJSON protocol:** new `stage-telemetry` event on `/generate/spec` and
   `/generate/stage`.
4. **Server log:** one
   `[staged-gen] stage complete {stage, model, durationMs, tokens}` structured
   line per stage — closes the observability hole from the motivation.
5. **Client:** stage progress rows / verbose log render the model chip, e.g.
   `Stage 3 · Port Mapping · [mercury-2] · 9.2s`.

**Tests:** telemetry shape, NDJSON parsing, cascade asserts both names.

## PR-3 — Explicit local override + pre-generate warning

**Problem:** there is no user-facing engine choice — `executionStrategy` is
hardcoded `"auto"` (`ImportProjectSpecPage.tsx`). After PR-1, users who _want_
local need an override, and they should be warned what they're signing up for.

**Changes**

1. Execution-engine selector (cloud / local) in the generate flows, persisted
   alongside `usePreferredLLM`.
2. `LocalGenerationWarningDialog` (shadcn AlertDialog) shown **on Generate
   click** only when the local override is active: "Some stages may fail with
   WebLLM models; cloud fallback will be used if available." Actions:
   Continue with local / Switch to cloud.
3. Thread the chosen strategy into `useStagedSpecGeneration` and
   `useLooseSpecConversion`.

**Tests:** dialog gating (explicit override only — not auto-resolved local),
persistence, strategy threading.

## PR-4 — Remove the first approve-manifest screen

**Problem:** the import flow shows `ManifestPreviewStep` (PREVIEW page-state)
with "Accept and Continue", then routes to `/projects/new/ai/accept`
(`ManifestAcceptPage`) which renders the same manifest again — two approval
screens for one decision.

**Changes**

- Delete the PREVIEW page-state from `ImportProjectSpecPage` (state machine,
  `ManifestPreviewStep`, footer branch).
- `handleAcceptAndContinue`'s logic (carried-name reconciliation,
  `setManifestIdentity`, `pendingManifest.set`) runs at generation-complete →
  navigate straight to `/ai/accept`.
- Re-home the wizard-parse error path (currently `setPageState("PREVIEW")` on
  failure): inline error on the generating step.
- **Verify before cutting:** whether `GenerateWithAi/StateView.tsx`'s
  `ManifestPreview` + `onApprove` is a live second instance of the same
  duplication in the prompt flow, or dead code.

## PR-5 — Tandem mode removal

**Rationale:** tandem (local draft + cloud refine in the browser) is
superseded by the server-side mercury → gpt-4o stage-1 cascade.

**Verified footprint**

- **`packages/tandem-execution`** — an entire workspace package
  (domain/application/infrastructure); consumed by `apps/web` and
  `packages/model-settings` (both declare it in `package.json`)
- `apps/web/features/governance-assistant/TandemChat/` — 12 components
- Hooks: `useTandemLlm`, `useTandemConfigReset`, `useTandemLostConfig`
- Integration: `GovernanceAssistantPanel`, `ModeWrapper`, `LocalModeView`,
  `LocalModeSettingsView`, `types.ts`
- `packages/model-settings`: `tandem-mode-badge.tsx`,
  `tandem-interception-modal.tsx`, `tandemStatus`/`onTandemDisabled` props,
  barrel exports (hand-edit `@generated` barrels — no `yarn sync`)
- Workspace plumbing: turbo scope, tsconfig references, two `package.json`
  dependency entries

Suggested split: 5a removes the UI/hooks layer (web + model-settings props);
5b deletes the `tandem-execution` package + workspace plumbing once nothing
imports it.

**Sequencing:** after #303 merges (it touches `ModelSettingsView.tsx` and
`LocalModeSettingsView.tsx`).

**Gate:** typecheck + full web suite + zero `[Tt]andem` matches outside git
history.

## PR-6 — Free-tier provider swap + in-app quotas

**Problem:** the free tier rides a slow (~40 tps) GLM-5.1 endpoint whose
latency is the de-facto rate limiter; the only real protection is the per-IP
10/min route limiter.

**Direction:** high-fidelity model(s) for free-tier traffic + explicit
application-level quotas (per-user/session counts, persisted server-side,
friendly exhaustion UX) instead of a slow endpoint as throttle.

**Open decisions (block this PR, not the plan):**

- Which model(s) for free-tier chat/Q&A (generation already = mercury-2)
- Quota policy: N generations + M chat messages per day; anonymous-session vs
  account scope
- Quota store: in-memory + periodic persistence vs SQLite/file (single
  container)

**Note:** prod env/secret changes gated on explicit per-command confirmation,
per the deploy runbook discipline.

## PR-7 — FreeTierModal UI refactor

**Blocked on:** Martin's HTML template (styling reference) + PR-6 (the modal's
copy describes the free-tier model/limits PR-6 redefines).

**Direction:** decompose the template into the component tree under
`apps/web/app/lib/free-tier/`, map styling to tailwind/shadcn tokens, rewire
`useFreeTier()` contextual data (model name is generation-truthful post-#303).

---

## Related

- Mercury-2 prod flip runbook: `docs/deploy/` (#302)
- Truthful model badges: PR #303
- Staged-pipeline cleanup (A4: stub deletion + `selectPipeline` flag removal) —
  **done**; tracked in `post-wave-c-remaining-work.md` (C3). Not part of this plan.
