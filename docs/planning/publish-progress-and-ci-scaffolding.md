# Publish to GitHub — Progress Dialog & CI Scaffolding

**Status:** Plan
**Suggested branches:** `feature/publish-progress-dialog` (Feature A), `feature/publish-ci-scaffolding` (Feature B)

> Two gaps observed after a real publish: (A) clicking **Push to GitHub** goes
> silent for the 30–45 s the GitHub work takes — no clear success/failure
> signal; and (B) the published repo has no `.github/` workflows, so Actions
> never run. These are independent and can ship separately.

---

## Feature A — Publish progress & result dialog

### Current behavior (verified)

- `ExportContext` is a state machine: `idle → dialog-open → exporting → success | error`.
- `Header` renders `ExportDialog` **only while `state.kind === "dialog-open"`** and a thin `ExportStatusStrip` below the header bar.
- On submit, `submitGithubExport` sets `state = exporting` → the dialog's `open` flips to `false` → **the dialog disappears**. The sole feedback is the header strip ("Pushing to GitHub…"), and on success it **auto-dismisses after 4 s** (`SUCCESS_AUTO_DISMISS_MS`).
- The publish round-trip is ~30–45 s (createRepo + `GET /user` + blobs×N + tree + commit + ref). A user looking at the wizard/summary — not the header — sees nothing happen, then maybe a 4 s green flash they miss. Hence "went silent."

### Goal

A clear, persistent affordance for the whole publish: in-progress → result, with the repo link on success and an error + retry on failure. No silent windows.

### Approach

Make the publish dialog **stay open and reflect `ExportContext.state`** instead of closing on submit:

1. **Keep the dialog mounted across `exporting | success | error`** for GitHub, and render a panel per state inside `ExportDialog`:
   - **form** — repo name + visibility (today's view).
   - **submitting** — spinner, inputs disabled, copy like _"Creating the repository and pushing files… this can take 30–45 seconds."_ **Non-dismissible — wire it** via the `Dialog` `onOpenChange`/close intercept (ignore close while `exporting`), not a comment. (A mid-push close leaves a half-created repo.)
   - **success** — ✓ + `owner/repo`, **Open repository** (the `htmlUrl`), **Copy URL**, and the "Connected to …" note; a Done button.
   - **error** — message + **Retry** (re-submits the last payload) and **Back to form**.
   - **Gate via a derived selector, not inline JSX.** Add `isGithubExportActive(state)` (or a derived boolean on context) and use it for the Header `open` condition, so Header stays dumb and can't drift from what the context considers "active" as states evolve. _(Review #1.)_
   - **Drop the eager `window.open(destinationUrl)`** on GitHub success — once the success panel has an explicit **Open repository** button, auto-opening a tab is redundant and surprising; the button becomes the sole navigation. _(Reviews #3, #4.)_
2. **Progress granularity — two options:**
   - **(A1, recommended first)** Indeterminate spinner + the time hint. Zero backend change; the existing single `exporting` state drives it.
   - **(A2, optional later)** Real **staged** progress (Creating repo → Pushing N files → Commit → Done) via **SSE** from `/api/export/github` (the route would stream stage events; client consumes with `EventSource`). Richer but needs route streaming + a progress event contract; defer.
3. **De-dupe the surfaces:** once the dialog owns GitHub feedback, scope `ExportStatusStrip` to the **ZIP**/non-modal path (or retire it for GitHub) so we don't show both.

The same pattern improves the **editor Push** flow (`useEditorPush`) — today it only opens the commit URL + inline error; a small shared result toast/dialog could be reused. Note as a follow-on, not in scope here.

### Phases

- **A1 — Dialog-driven states.** form/submitting/result, stays open, success link + copy, error + retry; scope the strip to ZIP. _Exit:_ a publish shows a persistent dialog (spinner → result); success reveals the repo link; failure offers retry.
- **A2 (optional) — SSE staged progress.** Stream stages from the route; show a step list. _Exit:_ the dialog shows live stages.

### State shape (enrich `ExportState`)

Today `success` carries only `message: string` and the route's `{ destinationUrl, githubLink }` are discarded after the message is built. The dialog needs structured data:

- `success` carries `destinationUrl`, `githubLink` (incl. `owner`/`repo`) — **from the route, not parsed out of the URL** (fragile). _(Reviews #3, #4.)_
- The context retains the **last submitted payload** (`repoName`, `isPrivate`) so **error → Retry** re-submits without forcing the user back through the form. **Decided:** hold it in a `useRef<{ repoName; isPrivate } | null>` in `ExportContext` (set at submit, cleared on `idle`) — **not** in the state machine, so it doesn't have to be threaded through the `exporting`/`error` variants. _(Review #5.)_

### Implementation constraints (DESIGN.md)

`ExportDialog` is an `apps/web/features/*` component (not `@hexagen/ui`), so holding interaction state is allowed (exempt from `NoSemanticState`). New panels must: compose existing `@hexagen/ui` primitives (`Dialog*`, `Button`, `Input`) + `lucide-react` icons; use token classes (`text-success`, `text-destructive`, `text-primary hover:underline`); stay on the 4px grid (`p-4`, `gap-2`, `space-y-4`); no arbitrary values, no inline styles, no `any`. _(Reviews #2, #3.)_

### Files in scope

- `apps/web/features/export/ExportDialog.tsx` — multi-state panels.
- `apps/web/app/contexts/ExportContext.tsx` — enrich `success` (`destinationUrl`/`githubLink`/`owner`/`repo`); retain last payload; add `isGithubExportActive`; drop `window.open` for GitHub.
- `apps/web/features/workspace-shell/Header.tsx` — `open` driven by `isGithubExportActive`.
- `apps/web/features/workspace-shell/ExportStatusStrip.tsx` — **atomic single-commit** swap: gate on `destination !== "github"` (don't leave both surfaces live across two PRs → transient double feedback). _(Review #1.)_

### Risks

- **Double feedback** (strip + dialog) — the atomic strip gate above.
- **Accessibility** — focus management, `aria-live` on the submitting/result regions, don't trap focus on a closable error.
- **Don't block forever** — surface a timeout/failure if the request hangs (the route already returns an error result; ensure the dialog renders it).

---

## Feature B — Published repos include a working `.github` CI

### Current behavior (verified)

- The export builds a manifest from `wizardData` and runs the **sync engine** (`ExternalSyncEngineAdapter` → `@hexagen/sync` `SyncEngine.run()`), then `collectFileTree()` → the exporter pushes the tree.
- A **separate** `template-engine` add-on system exists: `packages/template-engine/templates/ci-github-actions/` already outputs `.github/workflows/ci.yml`, `deploy-*.yml`, `.github/dependabot.yml` (gated by questions: triggers, deploy target, node version, …). It's surfaced in the wizard (`add-ons-step/template-catalog.ts` lists `ci-github-actions`) and applied via the `sync add` command.
- **The export route passes only `manifest`** — no selected add-ons/templates. The published repo had **no `.github`**, so the add-on outputs are not in the generated tree the exporter pushes.
- **The transfer is not the problem:** the exporter's `readFiles` has no dotfile/dot-dir filtering (verified), so it _would_ push `.github` if it existed. The gap is **generation**.

### Phase 0 — Discovery (answered; verified via source inspection + two reviews)

The original three questions are now answered (confirmed against source):

1. **Does `SyncEngine.run()` apply add-ons?** **No.** It is pure manifest-driven generation (layers/apps/stubs/root files/barrels) — zero template/add-on references. Add-ons are applied **only** via the `sync add` CLI (`@hexagen/template-engine`'s `AddTemplateUseCase`), never in the export path.
2. **Are wizard add-ons sent to export?** **No.** `wizard-to-manifest.ts` does not serialize `addOnsAnswers` into the manifest (it even comments that choices without a generator template are skipped); `SelectedAddOnsContext` is UI-only and the wizard step shows a CLI hint. So the data is dropped at manifest conversion.
3. **Does the CI template match the generated stack?** **Mostly, with one trap.** Every HexaGen-generated project is a **Turbo + Yarn + `node:test` monorepo** (the sync generator emits `turbo.json` + a `packageManager: yarn` root `package.json` via `generators/root-file-templates.ts`), so `turbo run` + `turbo-cache` are correct. **But** the rich template defaults `deploy_target: vercel`, which emits `deploy-vercel.yml` needing `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` → **guaranteed red** on first push. _(Reviews #3, #4.)_
4. **(Added) Runtime/arch boundary.** The export is a Next API route with workspace packages available, but threading add-ons through it means `project-generation` (core) taking a dependency on `template-engine` — a new port + `.architecture/manifest.yaml`/`context.yaml` edits + `yarn lint:arch` before any `.ts`. B-B avoids this entirely. _(Reviews #1, #3.)_

**Consequence — B-B is simpler than first written:** because the stack is _fixed_ (Turbo+Yarn+`node:test`), the floor CI is a **single hardcoded `ci.yml`** — no runtime stack detection, no manifest enrichment, no heuristics. Do not over-engineer "tuned to the stack." _(Review #4.)_

**Pre-existing dead code to reckon with:** `packages/project-generation/src/infrastructure/adapters/WorkflowGenerator.ts` + `src/assets/workflow-template.yml` exist but are **never wired** (no non-dist references — verified) — an earlier, abandoned attempt at export CI (and the asset is HexaGen-monaco-specific `sync-integrity`, not suitable as-is). **Read it in B1; repurpose or delete** rather than leaving a second dead CI path. _(Reviews #3, #4.)_

**Residual B0 step (small):** read `generators/root-file-templates.ts` to copy the exact root `scripts` (build/typecheck/lint/test) the generator injects, so the floor `ci.yml` invokes commands that exist.

### Goal

Every published project ships a `.github/workflows` CI that **runs green** out of the box (build/typecheck/lint/test for the generated stack), with deploy workflows strictly opt-in.

### Approach options (decided — Phase 0 answered above)

- **(B-A) Thread add-on selection into export generation** — pass selected templates + answers so the sync engine emits the add-on files (incl. `.github`). Best if add-ons are meant to be part of generated output.
- **(B-B) Minimal default CI in the base generation** — emit a small, self-contained `.github/workflows/ci.yml` (install + build + test, no external secrets) for **every** project, tuned to the generated stack. Guarantees green Actions with no setup.
- **(B-C) Default-on CI add-on for publishes** — make `ci-github-actions` selected-by-default (deploy target `none`) when publishing to GitHub.

**Recommendation:** Phase 0, then **B-B** as the floor (always-green, secret-free CI) and **B-A/B-C** as the richer path once add-on plumbing through export is confirmed. Keep **deploy workflows opt-in** (default `deploy_target: none`) so we never push a workflow that needs unset secrets.

### Phases

- **B0 — Discovery.** ✅ Effectively done (above). The **one true prerequisite for B1**: read `generators/root-file-templates.ts` and copy the exact root `scripts` the generator emits, so the floor `ci.yml` calls commands that exist (e.g. `yarn turbo build`, **not** `yarn build`). This is a B1 gating step, **not** parallel work. _(Review #5.)_
- **B1 — Floor CI.** _First commit:_ **delete** the dead `WorkflowGenerator.ts` + `assets/workflow-template.yml` (verified unwired) so there's one authoritative CI path. _Then:_ emit a single hardcoded, secret-free `ci.yml` (install → build → typecheck → lint → test via the generator's actual root scripts). _Exit:_ **a freshly published repo, cloned with no manual setup and no secrets configured, shows a green Actions run** — validated against the _real emitted scripts_ (the B0 read), on a clean repo (not one where you've already set secrets). _(Reviews #1, #5.)_ Floor CI also lands in **ZIP** exports (same path) — desirable.
- **B2 — Rich CI add-on (opt-in).** Thread `ci-github-actions` selection/answers through the export → generation path; **default `deploy_target: none`** (never emit a deploy workflow needing unset secrets). _Exit:_ selecting the CI add-on + an explicit deploy target produces matching, runnable workflows.

**Emission site — decided: inside `@hexagen/sync`'s root-file generators.** The floor CI is logically "what every generated project contains" — peer to `turbo.json` and the root `package.json` — and it's _not_ GitHub-specific (it also belongs in ZIP exports). So it lives with the other root files, not in `ExternalSyncEngineAdapter` (the GitHub/export-aware layer). This touches the `sync` context; update `.architecture/manifest.yaml` + `context.yaml` and run `yarn lint:arch` **before** the `.ts` changes. _(Review #5.)_ (B2's add-on threading is the separate case that adds a `project-generation → template-engine` port.)

### Files likely in scope

- **B1 (floor):** `@hexagen/sync` `generators/root-files*` **or** `ExternalSyncEngineAdapter` (emission site per B0); the dead `WorkflowGenerator.ts` + `assets/workflow-template.yml` (repurpose/delete); `.architecture/*` for the chosen seam.
- **B2 (rich, opt-in):** `apps/web/app/api/export/github/route.ts` + `apps/web/app/contexts/ExportContext.tsx` (carry add-ons/answers), `packages/wizard-orchestration/.../wizard-to-manifest.ts` (stop dropping `addOnsAnswers`), `packages/template-engine/templates/ci-github-actions/` (default `deploy_target: none`), `project-wizard/steps/add-ons-step/*`.

### Risks

- **Red CI is worse than no CI** — the hardest risk. The rich template's default `deploy_target: vercel` emits a deploy workflow needing `VERCEL_*` secrets → red on first push. Floor stays **build/test only, secret-free**; deploy strictly opt-in and never defaulted on auto-publish.
- **Two-engine coupling** — threading `template-engine` add-ons through the sync-engine/export path needs a new core→template-engine dependency (arch change); B-B sidesteps it for the floor.
- ~~Stack variance~~ — **not a risk:** the generated stack is fixed (Turbo+Yarn+`node:test`), so one hardcoded `ci.yml` suffices. Flagged only to prevent over-engineering a detection layer.

---

## Rollout

Both features are **forward-only**: new publishes get the dialog; new publishes/exports get the floor CI. **No retroactive** dialog or CI for already-published repos. Stated so it isn't filed as a bug. _(Review #1.)_

## Open decisions

1. **A:** indeterminate spinner (A1) now vs SSE staged progress (A2) later. _(Recommend A1 first.)_
2. **B:** floor CI (B-B) for all publishes vs full add-on wiring (B-A/B-C). _(Recommend B-B floor + opt-in rich.)_
3. **B:** default `deploy_target` for auto-publish. _(Recommend `none` — ship build/test CI only; deploy opt-in.)_

## Review dispositions (4 review passes)

- **A:** Header gating via `isGithubExportActive` selector (not inline); atomic single-commit strip swap; **wire** non-dismissible-while-exporting (not a TODO); **remove** the eager `window.open` on success; enrich `success` with `destinationUrl`/`githubLink`/`owner`/`repo` from the route; retain last payload for Retry; DESIGN.md constraints noted.
- **B:** Phase 0 answered + verified (no add-on application in `SyncEngine.run()`; `wizardToManifest` drops add-ons; fixed Turbo+Yarn stack ⇒ single hardcoded floor `ci.yml`, no detection); dead `WorkflowGenerator` flagged for repurpose/delete; rich template's `deploy_target: vercel` default is the concrete red-CI trap; B1 exit hardened to "green on a freshly cloned repo, no secrets"; emission-site/arch-lint impact spelled out.
- **Process:** land this plan as a tracking PR (`feature/...-plan`, per #186/#187); start **A** immediately (zero backend risk); **B1** may proceed since B0 is answered; keep deploy opt-in.

## Out of scope

- Per-stack deploy automation beyond build/test (Fly/Vercel/Railway wiring) — opt-in via the CI add-on's existing questions.
- Reworking the editor **Push** result UX (reuse Feature A's pattern later).
- Streaming progress (A2) unless A1 proves insufficient.
