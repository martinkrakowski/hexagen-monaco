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

1. **Keep the dialog mounted across `exporting | success | error`** for GitHub (Header `open` condition becomes `dialog-open || (destination github && exporting/success/error)`), and render a panel per state inside `ExportDialog`:
   - **form** — repo name + visibility (today's view).
   - **submitting** — spinner, inputs disabled, copy like _"Creating the repository and pushing files… this can take 30–45 seconds."_ Non-dismissible (or warn on close).
   - **success** — ✓ + `owner/repo`, **Open repository** (the `htmlUrl`), **Copy URL**, and the "Connected to …" note; a Done button.
   - **error** — message + **Retry** (re-submits without retyping) and **Back to form**.
2. **Progress granularity — two options:**
   - **(A1, recommended first)** Indeterminate spinner + the time hint. Zero backend change; the existing single `exporting` state drives it.
   - **(A2, optional later)** Real **staged** progress (Creating repo → Pushing N files → Commit → Done) via **SSE** from `/api/export/github` (the route would stream stage events; client consumes with `EventSource`). Richer but needs route streaming + a progress event contract; defer.
3. **De-dupe the surfaces:** once the dialog owns GitHub feedback, scope `ExportStatusStrip` to the **ZIP**/non-modal path (or retire it for GitHub) so we don't show both.

The same pattern improves the **editor Push** flow (`useEditorPush`) — today it only opens the commit URL + inline error; a small shared result toast/dialog could be reused. Note as a follow-on, not in scope here.

### Phases

- **A1 — Dialog-driven states.** form/submitting/result, stays open, success link + copy, error + retry; scope the strip to ZIP. _Exit:_ a publish shows a persistent dialog (spinner → result); success reveals the repo link; failure offers retry.
- **A2 (optional) — SSE staged progress.** Stream stages from the route; show a step list. _Exit:_ the dialog shows live stages.

### Files in scope

- `apps/web/features/export/ExportDialog.tsx` — multi-state panels.
- `apps/web/app/contexts/ExportContext.tsx` — carry `githubLink`/`destinationUrl` (and optionally `stage`) on `success`; keep the dialog open across states.
- `apps/web/features/workspace-shell/Header.tsx` — `open` condition.
- `apps/web/features/workspace-shell/ExportStatusStrip.tsx` — scope to ZIP (or retire for GitHub).

### Risks

- **Double feedback** (strip + dialog) — scope the strip.
- **Accessibility** — focus management, `aria-live` on the submitting/result regions, don't trap focus on a closable error.
- **Don't block forever** — surface a timeout/failure if the request hangs (the route already returns an error result; ensure the dialog renders it).

---

## Feature B — Published repos include a working `.github` CI

### Current behavior (verified)

- The export builds a manifest from `wizardData` and runs the **sync engine** (`ExternalSyncEngineAdapter` → `@hexagen/sync` `SyncEngine.run()`), then `collectFileTree()` → the exporter pushes the tree.
- A **separate** `template-engine` add-on system exists: `packages/template-engine/templates/ci-github-actions/` already outputs `.github/workflows/ci.yml`, `deploy-*.yml`, `.github/dependabot.yml` (gated by questions: triggers, deploy target, node version, …). It's surfaced in the wizard (`add-ons-step/template-catalog.ts` lists `ci-github-actions`) and applied via the `sync add` command.
- **The export route passes only `manifest`** — no selected add-ons/templates. The published repo had **no `.github`**, so the add-on outputs are not in the generated tree the exporter pushes.
- **The transfer is not the problem:** the exporter's `readFiles` has no dotfile/dot-dir filtering (verified), so it _would_ push `.github` if it existed. The gap is **generation**.

### ⚠️ Discovery (Phase 0 — do this before choosing an approach)

1. Does `SyncEngine.run()` apply `template-engine` add-ons encoded in the manifest, or are add-ons applied **only** via a separate `sync add` pass that the export path never invokes? (The two-engine seam is the crux.)
2. Are the wizard's selected add-ons (incl. `ci-github-actions`) carried into the `manifest`/`wizardData` POSTed to `/api/export/github`? (Today they appear **not** to be.)
3. Does the `ci-github-actions` workflow actually match the **generated** project's shape? Its checklist references Turbo + `TURBO_TOKEN`/`TURBO_TEAM`; if the generated project isn't a Turbo monorepo, the CI would run **red** on first push — worse than none.

### Goal

Every published project ships a `.github/workflows` CI that **runs green** out of the box (build/typecheck/lint/test for the generated stack), with deploy workflows strictly opt-in.

### Approach options (choose after Phase 0)

- **(B-A) Thread add-on selection into export generation** — pass selected templates + answers so the sync engine emits the add-on files (incl. `.github`). Best if add-ons are meant to be part of generated output.
- **(B-B) Minimal default CI in the base generation** — emit a small, self-contained `.github/workflows/ci.yml` (install + build + test, no external secrets) for **every** project, tuned to the generated stack. Guarantees green Actions with no setup.
- **(B-C) Default-on CI add-on for publishes** — make `ci-github-actions` selected-by-default (deploy target `none`) when publishing to GitHub.

**Recommendation:** Phase 0, then **B-B** as the floor (always-green, secret-free CI) and **B-A/B-C** as the richer path once add-on plumbing through export is confirmed. Keep **deploy workflows opt-in** (default `deploy_target: none`) so we never push a workflow that needs unset secrets.

### Phases

- **B0 — Discovery.** Answer the three questions above; pick B-A vs B-B (+ B-C). _Exit:_ documented decision + the exact generation seam to change.
- **B1 — Floor CI.** Emit a minimal green `ci.yml` in generated output; verify a freshly published repo's Actions run green. _Exit:_ a real publish shows a passing CI run.
- **B2 — Rich CI add-on.** Wire `ci-github-actions` selection/answers through export; tailor workflow to the generated stack; deploy opt-in. _Exit:_ selecting the CI add-on + a deploy target produces matching, runnable workflows.

### Files likely in scope (pending B0)

- `apps/web/app/api/export/github/route.ts` + `apps/web/app/contexts/ExportContext.tsx` — carry selected add-ons/answers (if B-A/B-C).
- `packages/project-generation/src/infrastructure/adapters/external-sync-engine.adapter.ts` and/or `@hexagen/sync` `SyncEngine` — apply add-ons / emit base CI.
- `packages/template-engine/templates/ci-github-actions/` — ensure the CI workflow matches generated output; secret-free default.
- Wizard: `project-wizard/steps/add-ons-step/*` (if defaulting the CI add-on on).

### Risks

- **Red CI is worse than no CI** — a generated workflow referencing the wrong build command or unset secrets (`TURBO_TOKEN`, deploy creds) fails on first push. Keep the default minimal, stack-correct, and secret-free; deploy strictly opt-in.
- **Two-engine coupling** — wiring `template-engine` add-ons through the sync-engine export path may be non-trivial; B-B sidesteps it for the floor.
- **Stack variance** — generated projects may target different stacks; the floor CI must detect/parameterize the build+test commands from the manifest.

---

## Open decisions

1. **A:** indeterminate spinner (A1) now vs SSE staged progress (A2) later. _(Recommend A1 first.)_
2. **B:** floor CI (B-B) for all publishes vs full add-on wiring (B-A/B-C). _(Recommend B-B floor + opt-in rich.)_
3. **B:** default `deploy_target` for auto-publish. _(Recommend `none` — ship build/test CI only; deploy opt-in.)_

## Out of scope

- Per-stack deploy automation beyond build/test (Fly/Vercel/Railway wiring) — opt-in via the CI add-on's existing questions.
- Reworking the editor **Push** result UX (reuse Feature A's pattern later).
- Streaming progress (A2) unless A1 proves insufficient.
