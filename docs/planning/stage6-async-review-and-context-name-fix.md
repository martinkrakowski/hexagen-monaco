# Stage-6 async review + context-name normalization

**Status:** planned (2026-06-18) · **Owner:** Martin
**Driver:** the nemotron-3-ultra Stage-6 reviewer pilot (PR #349) surfaced two
problems in prod. This plan fixes both. See `[[nemotron-stage-eval]]` memory and
the prod telemetry below.

---

## Context — what the pilot showed

`STAGE6_VALIDATOR_MODEL=nvidia/nemotron-3-ultra-550b-a55b` is live in prod (PR
#349). Re-running the same spec (`Architectural project configuration.md`, a
7-context / 8-aggregate / 44-VO / 34-use-case manifest) across two configs:

| maxTokens | retryCount | Stage-6 latency | findings                                           |
| --------- | ---------- | --------------- | -------------------------------------------------- |
| 4,000     | 1          | 47.9s           | **[R03] identity-access (FALSE)**, [R08] workspace |
| 12,000    | 0          | **109.1s**      | [R08] workspace, 2× [R16] (deterministic)          |

Two findings drive this plan:

1. **R03 is a false positive caused by a prompt-data inconsistency, not the
   model.** Proven repeatedly: Stage 7's `add-out-port (port 'UserRepositoryPort'
already present)` skip is a _per-context_ check, so `identity-access.out`
   already contains the repository port — directly contradicting R03 "ports.out
   is missing or empty." Root cause: `compileStage6Prompt` feeds the reviewer
   the context name in **two casings** — `<port_map>`/`<adapter_bindings>` render
   raw PascalCase `IdentityAccess` (Stage-3 `contextName`) while `<manifest_yaml>`
   is kebab `identity-access`. No reviewer can reconcile a contradictory input.
   (Same bug-class the F3 fix solved for _port_ names; the _context_-name axis
   was left raw.)

2. **Stage 6 is the blocking latency.** nemotron's token budget acts as a
   reasoning-length governor: 4k truncates → retry (48s); 12k lets it reason
   fully → one 109s pass (`retryCount:0`, input 5,161 / output 318 — the 318
   output tokens don't explain 109s; uncounted _reasoning_ does). Raising the
   budget removed the retry but made it slower. There is no free maxTokens
   sweet-spot; ~100s is nemotron's natural reasoning cost on a large manifest.
   **But Stage 6 is _advisory_** — the manifest is fully assembled at Stage 5;
   the findings never block the manifest from being usable. So the user should
   not wait ~100s staring at a spinner for an advisory result.

This plan does **not** change the reviewer model or cap reasoning (tracked
separately as the `STAGE6_VALIDATOR_REASONING` option). It removes the _reasons
the latency hurts_ (async) and the _one model-independent false positive_
(normalization).

---

## Part C — context-name normalization (quick, deterministic, ship first)

**Goal:** make the Stage-6 prompt internally consistent so a correct manifest
can't produce a grounded false R03 (or R02/R04…) from a casing mismatch.

**Change:** in `packages/agentic-interaction/src/domain/prompts/generate-manifest.prompt.ts`,
`compileStage6Prompt`:

- line ~731 (`<port_map>`): `context: ctx.contextName` → `context: normalizeContextName(ctx.contextName)`
- line ~757 (`<adapter_bindings>`): same.
- Import `normalizeContextName` by **adding it to the existing line-40 import**:
  `import { normalizePortName } from "../manifest/normalize-draft";` →
  `import { normalizePortName, normalizeContextName } from "../manifest/normalize-draft";`.
  It lives in that same module; the file currently imports only `normalizePortName`
  (used for the F3 port-name normalization). No new import line needed.

Now all three prompt sections key contexts by the same kebab name the assembled
YAML uses, matching how the findings already reference them (kebab).

**Why it's safe / low-risk:**

- The assembled `<manifest_yaml>` and the findings are already kebab; this only
  fixes the two sections that diverged.
- Port names are _already_ normalized here (the F3 fix) — this completes it.
- `normalizeContextName` is idempotent on already-kebab names.

**Tests:**

- Existing `execute-validation-review.test.ts` port_map/adapter_bindings tests use
  kebab `contextName` ("invoice-management", …) → normalization is a no-op, still
  green.
- **Add** a test: a PascalCase stage-3 `contextName` ("IdentityAccess") renders
  as `"context":"identity-access"` in the compiled prompt (asserts the fix).

**Verification:** re-run the prod spec; R03 on identity-access should not recur
across repeated generations (today it's confounded by generation variance — this
removes the variance).

**Scope:** 1 source file + 1 test. Independent of Part B. Ship as its own PR.

---

## Part B — async / non-blocking Stage-6 review

**Goal:** show the assembled manifest immediately (after Stage 5) and stream the
Stage-6/7 findings when ready, instead of blocking the user on the ~100s review.

### Backend (the seam is already clean)

Both streaming orchestrators assemble the manifest before Stage 6:

- `execute-structured-config-generation.use-case.ts`: `assembledManifest` at
  ~1772, `onProgress?.(5, …)` at 1782, Stage 6 starts at 1786.
- `execute-full-staged-generation.use-case.ts`: analogous.

1. Add `onManifestReady?: (manifest: AssembledManifest) => void` to
   `StructuredConfigGenerationCallbacks` (line 45) and
   `FullStagedGenerationCallbacks`.
2. Fire it **between Stage 5 completion and Stage 6 start** (after line 1782 /
   the full-staged equivalent) with `assembledManifest`.
3. The orchestrators' return value is unchanged (still the final, possibly
   Stage-7-repaired, manifest + validation + repair).

### Route protocol (spec + stage routes)

Emit two events instead of one terminal `done`:

- **`manifest`** (on `onManifestReady`): `{ yaml, contextCount, portCount,
adapterCount, transactionId }` — fired right after Stage 5.
- **`done`** (unchanged name, after `execute()`): keep the full payload
  (`yaml`, counts, `validation`, `repair`). **Keep `yaml` in `done`** so it
  carries the final/repaired manifest — the client replaces only if it differs
  from the `manifest` event (Stage 7 rarely edits, but must be handled).

Backward-compatible: a client that ignores `manifest` still works off `done`.

### Frontend — three things the first draft under-specified

The streaming consumers are `useStagedManifestGeneration.ts` (AI-prompt flow) and
`useStagedSpecGeneration.ts` (spec-import flow). But three details change the shape:

**1. Navigation lives in the PAGE, not the stream hooks — and must not
auto-navigate.** The actual `setPendingManifest(...)` + `router.push("/projects/new/ai/accept")`
is in **`AIGenerationPage.tsx:handleUseManifest` (line 65)** (and the equivalent in
`ImportProjectSpecPage.tsx`). The stream hook has no navigation awareness, so an
`onManifestReady` signal must surface from the hook UP to the page. And per
`[[feedback_no_auto_navigate_telemetry]]` (flows on log/telemetry screens get an
explicit Next, never `router.push` from the success arm), Part B must **not**
auto-navigate on `manifest`.

> **Decision (explicit): keep the telemetry park.** On the `manifest` event,
> **enable "Use This Manifest" early** (manifest is ready at Stage 5) with a
> "validating…" affordance; the user clicks Next when ready. This removes the
> ~100s block (today the button only appears after `done`) while preserving the
> user-initiated navigation the principle requires.

**2. The Stage-6 findings are not propagated today — a store-shape change is
required.** `ManifestAcceptPage`'s `hasFailures` derives from
`parseYamlToViewData(pendingManifest.yaml)` — _structural_ YAML validation, NOT the
Stage-6 `ValidationReport`, which currently lives only in the stream hook's local
state and is dropped. `usePendingManifest` holds `{ yaml, formValues, projectName,
originPath }` — no findings. So the deferred gate needs: add
`{ stage6Findings: ValidationReport | null, validationPending: boolean, repair? }`
to `usePendingManifest` (or a thin parallel store), and have `ManifestAcceptPage` /
`ManifestPreview` read the gate + the "reviewing…" state from it. Approve gate:

- **(b1, chosen)** defer — gate "Use This Manifest" on `stage6Findings.hasFailures`
  once present; show "validating…" while `validationPending`.
- (b2) advisory-only (no blocking gate). Not chosen.

**3. The stream is COMPONENT-owned — navigating mid-stream aborts Stage 6.**
`useStagedManifestGeneration` holds an `AbortController` in a ref and aborts on
unmount ("Generation aborted"). So if the user clicks Next at Stage 5 and
navigates, the stream aborts and **Stage 6 never finishes → no findings.** Two
ambition levels:

- **B-lite (recommended first):** keep the stream on the generation/telemetry
  screen; findings stream into the store as Stage 6 completes _while the user is
  still there_. Enable Next at `manifest`; if the user clicks Next before `done`,
  the approve screen shows the manifest + "validation unavailable — re-run to
  review" (graceful). Minimal change, honors the park, delivers the "proceed
  without waiting for the review" win.
- **B-full (follow-up):** lift the stream lifecycle out of the component into a
  store/provider — `useExecutionEngine` is already a persisted zustand store and is
  the natural home — so it survives navigation and writes findings from either
  screen. Delivers "navigate at Stage 5, findings stream into the approve screen
  async," but it's a real stream-ownership refactor.

Either way, `ManifestPreview`'s validation tab + Stage-6 chip need a
pending/"reviewing" state (today they assume findings exist at render); and if
Stage 7 repairs, `done.yaml` replaces the displayed manifest (rare — surface a
subtle "updated by repair" note).

### Scope & non-goals

- **In scope:** the two **streaming** routes (`/spec`, `/stage`) — `/spec` is the
  telemetry path.
- **Out of scope (follow-up):** the non-streaming `/api/manifest/generate` (root)
  and `/local` routes return a single JSON, so async needs a different mechanism
  (poll / second request); leave blocking for now.
- **Not in this plan:** changing the reviewer model or capping reasoning
  (`STAGE6_VALIDATOR_REASONING` — separate lever).

### Risks

- Stage 7 repair changing the manifest after it's displayed → handled by the
  `done.yaml` replace path; surface a subtle "manifest updated by repair" note.
- Stream disconnect after `manifest` but before `done` → the client has a usable
  manifest but no findings; show a "validation unavailable — re-run to review"
  state rather than hanging.

---

## Sequencing

1. **Part C** (context-name fix) — small, independent, ships the R03 fix. PR 1.
2. **Part B** (async review) — backend callback + route protocol + frontend. PR 2.
3. Prod re-test with the spec after each; confirm R03 gone (C) and manifest
   renders pre-review (B).

## Open decisions for Martin

- **B-lite vs B-full** (the main one): B-lite = enable Next at Stage 5, stream
  stays on the gen screen (minimal, honors the park). B-full = lift the stream to
  `useExecutionEngine` so findings stream into the approve screen after early
  navigation (richer UX, stream-ownership refactor). Default: **B-lite first,
  B-full as a follow-up.**
- Approve gate: **b1** (defer + gate on Stage-6 findings via the store) — already
  chosen above; flagged here only to confirm.
- No-auto-navigate: resolved — keep the park, enable Next early (per
  `[[feedback_no_auto_navigate_telemetry]]`).
- Whether to also pursue the `STAGE6_VALIDATOR_REASONING` reasoning-cap lever in
  parallel (complementary: async hides the latency, a reasoning cap reduces it).
- Non-streaming routes (`/root`, `/local`): leave blocking, or follow-up to a
  poll-based review.
