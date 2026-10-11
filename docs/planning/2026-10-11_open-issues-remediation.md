# Open issues remediation: #766, #521, #428

Written by a Fable read-only pass for the fleet session, 2026-10-11; nothing in it is started.

Read against `origin/main` at `44b93b98` on 2026-10-11. Nothing changed, nothing installed, nothing run except `gh`, `git`, `grep`, and `yarn bin`.

**Summary**

- #766 still present on the live page: `ModelSelectionPage.tsx` starts a local download without checking WebGPU. One apps/web lane on that page. The flow-hook path first planned here has no live caller (found in review of #868).
- #521 still present, with a stopgap on top: `model-settings` floats `react` to 19.2.5 beside web's 19.2.4, and `react-dom` is pinned exactly to survive it. One lockfile lane, run alone.
- #428 half fixed: the bin gap was closed by #455; the turbo `inputs` landmine remains and is a `turbo.json`-only change, or a comment-close.

## #766 Model selection never reaches `unsupported`

**Correction (2026-10-11, after the review of #868).** The local-model choice a user can reach is `apps/web/features/manifest-generation/ModelSelectionPage.tsx` (`handleSelectModel`, which calls `ctx.switchModel` / `ctx.initializeModel`), on the route `/projects/new/ai/models`. `selectLocalModel` and `repairModelDownload` in `useModelDownloadActions.ts` are called only by `ModelSelectionContainer` / `SimpleModelSelection`, which no route renders. Guarding them fixes nothing, and the text below that names `SimpleModelSelection.tsx` as the place the user clicks is wrong.

**Fix (the owner's decision, 2026-10-11).** In `ModelSelectionPage.tsx`: when WebGPU detection has resolved `false` (`useWebGPUDetection`, or the engine status `no_webgpu` / `unsupported_browser`), a local choice or Retry calls neither `initializeModel` nor `switchModel` and shows an inline `Alert` above the model list. A download already in flight is cancelled with `ctx.cancelDownload()`. Detection not finished proceeds as before. The page has no cloud-model choice, so there is no "Use a cloud model" button; the way out is the footer Back. The state machine, `StateView` and the flow hook are not touched.

**Proof.** `__tests__/ModelSelectionPage.webgpu-unsupported.test.tsx` renders the page with detection `false`, not finished and `true`, clicks a model card, and asserts the call counts and the notice.

**Follow-ups, not in that change.** Delete the two unused components and their actions. Guard the remembered-model auto-resume in `useModelSelectionFlowEffects.ts` (about lines 159-235), which is live on `/projects/new/ai`. Disable the local cards in `@hexagen/model-settings` when WebGPU is absent.

**Superseded (kept for the record):**

**1. Still present.** `apps/web/features/manifest-generation/ModelSelectionFlow/model-selection-state-machine.ts:13` declares `"unsupported"` and line 72 lists its exits, but no state lists it as an entry and no `ModelSelectionEvent` yields it. `useModelSelectionFlowEffects.ts` (around line 50) copies `gpuDetection.isWebGPUSupported` into `hardwareCapabilities` and stops. `useModelDownloadActions.ts` `selectLocalModel` (line 25) calls `initializeModel` unconditionally. `__tests__/useModelSelectionFlowState.test.ts:255-271` pins the gap ("leaves state idle ... see #766") and holds the `it.todo`. `StateView.tsx:132` and `GenerateWithAiError.ts:4,20` are dead code.

**2. Root cause.** The state, view and error code were designed (#291) but never wired; the 8.12(h) extraction (#563) moved the dead parts intact. Hurts a user without WebGPU who picks local: `SimpleModelSelection.tsx:118-131` disables the button only after async detection resolves; a click that lands first, or the remembered-model auto-resume in the effects hook, starts a download that fails and is reported as `network_failure` (INFERRED: the engine's failure mode).

**3. Fix.** Owner decision: transition at mount or only on the local path. Recommend **on the local path**: the cloud path needs no WebGPU, and the `unsupported` view offers only "Back to Description".

- `model-selection-state-machine.ts`: event `{ type: "WEBGPU_UNAVAILABLE" }` → `"unsupported"`; add `"unsupported"` to the exits of `idle` and `model_selection`.
- `useModelSelectionFlowState.ts` → `useModelDownloadActions.ts`: pass `flowState.hardwareCapabilities?.isWebGPUSupported`; in `selectLocalModel` and `repairModelDownload`, when it is `=== false`, set `state: "unsupported"`, `errorCode: "webgpu_unavailable"`, `error: GENERATE_WITH_AI_ERROR_MESSAGES.webgpu_unavailable`, and return before `initializeModel`. `undefined` (not yet detected) proceeds as today.
- `useModelSelectionFlowEffects.ts`: the same guard before the remembered-model auto-resume.
- Owner wording call, optional: `StateView.tsx:132` gains "Use a cloud model" (`transitionTo("model_selection")`, already a legal exit).
  Alternative: at mount, in the effects hook, when detection resolves false and state is `idle`. Simpler, but every Firefox/Safari user sees a red "Unsupported Browser" screen before the cloud option. Not a one-way door, but user-visible.

**4. Proof.** Make the `it.todo` real: the file's mocks already resolve `detect` → `supported: false` at the `app/lib/wire` seam and `renderFlowState()` drains the probe. Call `selectLocalModel(QWEN3_8B, false)`; assert `state === "unsupported"`, `errorCode === "webgpu_unavailable"`, `mockInitializeModel` uncalled. Fails today (`model_downloading`). Add the inverse (`supported: true`, OffscreenCanvas stubbed as line 163 does → `model_downloading`), and `canTransition` cases in `model-selection-state-machine.test.ts`, which has zero mentions of `unsupported`. No GPU needed.

**5. Risk and size.** Regression: auto-resume on a machine where detection is slow; guarding on `=== false` only avoids it. S, 1 lane, apps/web only. User-facing review only if StateView wording changes.

## #521 model-settings resolves its own React

**1. Still present, partly changed.** `packages/model-settings/package.json:34` `react: "^19.0.0"` (narrowed from the `^18 || ^19` the issue quotes, by #456), `:35` `react-dom: "19.2.5"` exact (#524 stopgap), `:30` `@types/react: "^19.0.0"`. `apps/web/package.json:71-72` `^19.2.4`. `yarn.lock:10481` `react@npm:^19.0.0 → 19.2.5`, `:10488` `react@npm:^19.2.4 → 19.2.4`, `:10351` `react-dom@npm:19.2.5`, `:10362` `react-dom@npm:^19.2.4 → 19.2.4`. Installed: `packages/model-settings/node_modules/react` is 19.2.5, root is 19.2.4. `yarn.config.cjs` lists `react` in `KNOWN_SPLITS`, whose guard only fires on `ranges.size < 2`; three ranges pass. Four `vi.mock("@hexagen/model-settings")` stubs remain in apps/web (`ModelSelectionPage.name-legs`, `governance-capability-probe`, `governance-panel-views`, `governance-assistant-panel-notice`).

**2. Root cause.** A caret range on a package whose peers must be one instance. Hurts developers: no apps/web test can mount a model-settings component, and the package needed an exact `react-dom` pin to run its own tests. INFERRED: production is unaffected because Next's App Router aliases `react` to its vendored copy; nothing on main proves it.

**3. Fix.** `packages/model-settings/package.json`: `react: "^19.2.4"`, `react-dom: "^19.2.4"`, `@types/react: "^19.2.14"`; keep `peerDependencies.react ^19.0.0`. `yarn install`; expected lockfile diff: the `react@npm:^19.0.0` and `react-dom@npm:19.2.5` blocks removed, no block added (corrected by #869, where the install was run: the `@hexagen/model-settings` workspace entry's own three range lines also change, because the lockfile mirrors a workspace's declared ranges; no other resolution moves). Then `yarn.config.cjs`: record the expected split (`react`, `react-dom`: `^18.3.1` for `tui`, `^19.2.4` elsewhere) so a third range fails `yarn constraints`; the existing `KNOWN_SPLITS` guard stays green. Owner decisions: dependency policy (model-settings' devDep tracks web's minor) and whether the constraints hardening is in scope. Alternative: narrow only, leave the class open. No one-way door. Follow-up lane: delete the four stubs and mount `ModelSettingsView` for real.

**4. Proof.** Before: the new constraint reports `model-settings react ^19.0.0`; `grep -c '^"react@npm' yarn.lock` is 3. After: 2, constraints clean, `packages/model-settings/node_modules/react` absent. Runtime: a web test rendering `ModelSettingsView` unmocked — `Invalid hook call` before, green after. Reviewable without installing: `git diff -- yarn.lock` must remove the two blocks, add no block and move no other resolution (not literally "deletions only": the workspace entry's three range lines change).

**5. Risk and size.** Lockfile churn: runs alone per the sweep rule. Regression surface: model-settings' suite (#524) and web. S, 1 lane (+1 optional for stub removal). No user-facing review.

## #428 Web test ergonomics

**1. Item 1 already fixed; item 2 still present.** #455 (`00c77715a`) declared `vitest` in `apps/web/package.json`; `apps/web/node_modules/.bin/vitest` exists and `yarn bin vitest` from `apps/web` resolves `apps/web/node_modules/vitest/vitest.mjs`; guarded by `packages/sync/__tests__/workspace-tool-declaration.guard.test.ts`. Item 2: `turbo.json` `test.inputs` is `src/**`, `__tests__/**`, `tests/**`, `tsconfig*.json`, `package.json`, copied into seven per-package overrides; apps/web keeps tests under `features/`, `app/`, `lib/`, `components/`, `utils/`, plus `vitest.config.ts`, `vitest.setup.ts`; root `vitest.shared.ts` is not in `globalDependencies`. `cache: false` everywhere, so inert.

**2. Root cause.** `inputs` was shaped for `src/` packages and never widened. Hurts nobody today; hurts CI the day someone flips `cache: true` and stale tests pass.

**3. Fix.** Smallest correct change: delete the `inputs` arrays from the eight test-type tasks (turbo then hashes every tracked file in the package) and add `vitest.shared.ts` to `globalDependencies`. Alternative: complete the globs; more upkeep, same effect. Owner decision (CI): if test caching is "never", record that in `AGENTS.md` (JSON cannot carry the comment) and close. Not a one-way door.

**4. Proof.** `turbo run test --filter=web --dry-run=json`: the hashed-inputs list lacks `features/**` before and includes it after. Item 1: comment-close citing #455 and the `yarn bin` output.

**5. Risk and size.** Near zero; `turbo.json` only. XS, half a lane. No user-facing review.

## Order

1. **#428** first and in parallel with anything: comment-close item 1; land item 2 in one tiny PR, or close outright if the owner rules caching out.
2. **#766** in parallel with #428 (apps/web `features/manifest-generation` only).
3. **#521** alone afterwards: lockfile churn gets its own wave. No file overlap with #766 (#766 edits `ModelSelectionPage.tsx` and adds one test file; #521's stub cleanup edits four other tests), but the rule is about the lock. #521 unblocks real mounting in future web tests; nothing depends on #766.

Close instead of fix: only #428 item 1.

## Not verified

- INFERRED: the engine's failure without WebGPU and its mapping to `network_failure`; not reproduced in a browser.
- INFERRED: Next App Router dedupes React in production; no production repro of #521.
- The #521 lockfile diff was INFERRED to be deletions-only. Run in #869: 24 lines removed, 3 added; the 3 are the workspace entry's own range lines, and no block was added.
- Not run: any test, `yarn constraints`, `turbo --dry-run`.
- Line numbers are from `44b93b98`; the agent worktrees under `.claude/worktrees` were not inspected.
