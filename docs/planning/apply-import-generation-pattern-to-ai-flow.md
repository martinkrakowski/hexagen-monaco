# Apply Import Generation Pattern to AI Flow — As-Built Notes

**Status:** shipped in PR #194. This is a condensed as-built record of applying
the import flow's generation pattern to `/projects/new/ai` — the durable
rationale, not the original step-by-step plan (that's in git history). Open
follow-ups live in [ai-generating-screen-followups.md](./ai-generating-screen-followups.md).

## What changed

`/projects/new/ai` ("Generate with AI") previously kept the form visible
(disabled) with `ThinkingBlock` appended at the bottom, and cloud progress was
frozen until generation resolved. It now mirrors `/projects/new/import/spec`:
while generation is in flight it shows a dedicated full-height "Generating
Manifest" screen (`AiGeneratingStep`) with live stage progress and a generation
log, and Cancel moves to the shell footer.

## Key design decisions

### The two endpoints stream chunks differently (the important gotcha)

The spec and staged endpoints use **different chunk conventions**, so the
verbose-log wiring is _not_ copy-paste between the two flows:

- **Spec** (`/api/manifest/generate/spec` route) emits `chunk` events at stage
  **-1** carrying curated **status text** (search the route for `stage: -1`).
  The spec hook treats `stageProgress[-1].chunks` as the log.
- **Staged** (`/api/manifest/generate/stage` route) emits `chunk` events at the
  **real stage number (0–6)** carrying raw **LLM tokens** — nothing is ever sent
  at -1.

So the AI cloud log is built from the numbered-stage chunks, grouped under a
`Stage N` header per stage. It is therefore **raw-token output**, not the
curated status lines the import flow shows. Import-style status lines would need
a status-text callback in the staged pipeline (none exists today) — a backend
change that was out of scope.

### Verbose log (the lowest-confidence piece)

- **Cloud:** raw tokens, accumulated **incrementally** per stage — only
  newly-arrived chunks are appended (tracked by a consumed-count ref), kept
  O(new tokens), and updated _before_ the `isGenerating` guard so the final
  chunk isn't dropped when it batches with the stream's `done`/`failed` event.
  "Option a" (ship raw tokens) was chosen; **not yet visually validated** — see
  the follow-ups doc.
- **Local WebLLM:** no verbose log — its use case only exposes
  `onProgress(detail)`, which already drives the detail line.

### When the full-height screen shows (`showGeneratingScreen`)

The swap is gated so the screen shows only while generation is **actively
streaming** — not on error, and not while a local model is downloading / loading
into VRAM:

- **Error → fall back to the form's** inline retry / "Clear & Start Over" UI.
  This depends on the hook setting `generationError` even for cloud failures:
  the staged stream **resolves** (it doesn't throw) on an in-stream
  `{type:"error"}`, so `useStagedManifestGeneration` mirrors `phase: "failed"`
  into `generationError` itself (matching `useStagedSpecGeneration`). Without
  that, the screen would be stuck blank.
- **Model loading → fall back to the form** so the `ModelProgressCard` modal
  stays reachable.

`AiGeneratingStep` has no error banner — by the gate above it only mounts when
there is no error.

### Footer Cancel

During generation the in-body `ActionBar` is gone (the form is swapped out), so
Cancel moves to the shell footer. `GenerateWithAi` publishes a cancel action
(`GeneratingFooterActions`, not a bare boolean) via `onGeneratingStateChange`,
and `AIGenerationPage` renders the footer with precedence preview → Cancel →
Back.

## Where it lives

- `useStagedManifestGeneration` — cloud-stream mirroring + `verboseLog`.
- `GenerateWithAi/AiGeneratingStep` — the full-height view (wraps `ThinkingBlock`).
- `GenerateWithAi` — the `showGeneratingScreen` gate + cancel plumbing.
- `AIGenerationPage` — footer Cancel.
- `GenerateWithAi/types` — `GeneratingFooterActions`.
- Tests: `__tests__/useStagedManifestGeneration.test.ts` (cloud path).
