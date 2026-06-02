# AI Generating Screen — Follow-ups

## Context

PR #194 (`feat/ai-flow-generating-screen`) added a dedicated full-height "Generating Manifest" screen + live cloud log to the `/projects/new/ai` flow; a follow-up commit (`9551bb63`) fixed three review bugs (cloud-error fallback, model-loading modal reachability, O(n) verbose-log builder).

This doc captures the items deliberately **deferred** from that PR's code review (findings #4, #5, #7) plus open validation threads. None block the PR; they're the next layer of polish/hardening.

## Follow-ups

### 1. Unify `AiGeneratingStep` and `ManifestGeneratingStep` (review #4 + #7) — High value, low effort

**Problem.** `GenerateWithAi/AiGeneratingStep.tsx` is a near-verbatim copy of `import-project-spec/ManifestGeneratingStep.tsx`; they differ only in whether they forward `stageLabels` to `ThinkingBlock`. `ThinkingBlock` already treats `stageLabels` as an optional override (`GenerateWithAi/ThinkingBlock.tsx:316` — `stageLabels?.[phase] ?? STAGE_LABELS[phase]`), so a single component covers both flows. The duplicated `generationError` prop/banner is review finding #7 — dead for the AI flow (which now falls back to the form on error) but live for the import flow, so it belongs on the shared component.

**Approach.**

- Promote one `ManifestGeneratingStep` to a shared location (recommend the feature root `features/manifest-generation/`, alongside `ManifestPreview.tsx`), keeping the optional `stageLabels?: Partial<Record<StagedPhase, string>>` prop.
- Import flow: pass `SPEC_STAGE_LABELS` (unchanged). AI flow: render it without `stageLabels` (ThinkingBlock's built-in AI labels).
- Delete `GenerateWithAi/AiGeneratingStep.tsx`; update imports.

**Files:** `import-project-spec/ManifestGeneratingStep.tsx` (move/generalize), `GenerateWithAi/AiGeneratingStep.tsx` (delete), `GenerateWithAi/GenerateWithAi.tsx` + `ImportProjectSpecPage.tsx` (import paths).

**Risk:** Low — pure dedup, no behavior change. Verify both flows still render.

### 2. Validate the cloud verbose log on screen (the "option a" reassess) — High value, trivial effort

**Problem.** The cloud verbose log renders **raw LLM tokens grouped per stage** (the chosen "option a"). It was never visually verified (the screenshot step was skipped). Raw token output may read as soup.

**Approach.** Run a real cloud generation at `/projects/new/ai` (OpenRouter is configured) and eyeball the log. Decide: keep as-is, tune formatting, or drop the cloud log (keep only the stage dots + detail line). If keeping but noisy, the deeper option is a server change to emit curated status text at stage `-1` (like the spec endpoint) instead of raw tokens — but `ExecuteStagedGenerationUseCase` has no status-text callback today, so that's a non-trivial backend change.

**Files:** none unless we change behavior — then `useStagedManifestGeneration.ts` (client) and/or `app/api/manifest/generate/stage/route.ts` (server).

**Risk:** Decision only.

### 3. Add regression tests for the fixed bugs — Medium/high priority

**Problem.** There is no `useStagedManifestGeneration.test.ts`, and the most severe review bug (cloud `phase: "failed"` must set `generationError`) has no coverage. The `showGeneratingScreen` gating is also untested.

**Approach.**

- Hook test: `generate()` resolving with `phase: "failed"` sets `generationError` (mirror the existing `__tests__/useStagedSpecGeneration.test.ts`). Cover the local WebLLM throw path too.
- Optional component test (if the RTL setup allows): `GenerateWithAi` shows the generating screen while in flight and falls back to the form's inline error on a cloud failure.

**Files:** `__tests__/useStagedManifestGeneration.test.ts` (new); optional `GenerateWithAi` render test.

**Risk:** Low.

### 4. Share the generating-screen scaffold + Cancel-footer across flows (review #5) — Medium priority, larger refactor

**Problem.** Both flows independently implement (a) a `dot-grid bg-ambient p-4` full-height wrapper around a generating step and (b) a shell footer whose only generating-state action is Cancel. AI: `GenerateWithAi.tsx` early return + `AIGenerationPage.tsx` Cancel branch. Import: `ImportProjectSpecPage.tsx` (wrapper ~388–398, footer ~323–336). They already differ slightly (import footer has a left-aligned label; AI uses a bare `<span/>` spacer) and will keep drifting.

**Approach.** Extract a shared `GeneratingScreen` layout (the wrapper) and a small footer-actions contract (Cancel / Go-Back) used by both pages. Touches `ProjectsShell` footer composition in both pages — scope carefully and verify both flows manually.

**Files:** new shared layout/footer helper; `GenerateWithAi.tsx`, `AIGenerationPage.tsx`, `ImportProjectSpecPage.tsx`.

**Risk:** Medium — touches two live flows and their footers.

### 5. (Optional, blocked) Local WebLLM verbose log + stage telemetry parity — Low priority

**Problem.** The local WebLLM path populates neither `verboseLog` nor per-stage `stageProgress` durations (only `phase`/`stepDetail`), so for local generation the screen shows moving dots + detail but no log or durations. Intentional today: `ClientManifestGenerationUseCase` exposes only `onProgress(detail)`, no token-level `onChunk` (unlike the spec use case).

**Approach.** Revisit only if the client manifest use case gains a token-level `onChunk` / stage-telemetry callback; then wire it the way the cloud path is wired.

**Risk:** Blocked on upstream capability — no action now.

## Suggested sequencing

1. **#2 (validate the log)** — cheap, and may change scope (if we drop the cloud log).
2. **#1 (unify components)** — quick win, independent.
3. **#3 (tests)** — lock in the bug fixes against regression.
4. **#4 (shared scaffold)** — larger refactor; do when next touching this area.
5. **#5** — only if upstream gains streaming.
