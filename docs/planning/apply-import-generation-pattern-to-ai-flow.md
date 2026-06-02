# Apply Import Generation Pattern to AI Flow

## Problem

The `/projects/new/import/spec` flow surfaces a dedicated full-height generation screen with a log and progress bar during manifest generation. The `/projects/new/ai` flow does not — it keeps all form fields visible (disabled) and appends `ThinkingBlock` at the bottom with no dedicated vertical space. The cloud progress is also frozen until generation resolves, and the verbose log is not wired.

## Key Difference

| Aspect                   | Import Flow                                                                                                 | AI Flow (Current)                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout during generation | Dedicated full-height screen; form disappears                                                               | Form stays visible (disabled); `ThinkingBlock` appended                                                                                                      |
| `ThinkingBlock` sizing   | `flex-1 min-h-0` — fills remaining space                                                                    | Inline, no dedicated vertical space                                                                                                                          |
| Cloud stream mirroring   | Real-time via `useEffect` on `stream.phase/stepDetail/stageProgress` (`useStagedSpecGeneration.ts:118-132`) | **None** — `useStagedManifestGeneration` only copies result _after_ `cloudStream.generate()` resolves, so the dots/detail are frozen during cloud generation |
| Verbose log              | Wired (`verboseLog` from `useStagedSpecGeneration`)                                                         | Not exposed by `useStagedManifestGeneration`; omitted at `GenerateWithAi.tsx:412`                                                                            |
| Footer                   | Cancel / Go Back (`ImportProjectSpecPage.tsx:323-342`)                                                      | Full form footer with Generate button; Cancel lives in-body in `ActionBar`                                                                                   |
| Background               | `dot-grid bg-ambient`                                                                                       | `dot-grid` only (from `GenerateWithAiLayout.tsx:9`)                                                                                                          |

## ⚠️ Critical correction: the two endpoints stream chunks differently

The first draft of this plan said to copy the spec hook's `cloudStream.stageProgress[-1].chunks → verboseLog`. **That would always be empty for the AI flow.** The endpoints use different chunk-stage conventions:

- **Spec** (`/api/manifest/generate/spec/route.ts:97`): `onChunk: (chunk) => send({ type: "chunk", stage: -1, data: chunk })` — curated **status text** at stage **-1**. This is why `stageProgress[-1]` is the log.
- **AI / staged** (`/api/manifest/generate/stage/route.ts:86`): `onChunk: (stage, data) => send({ type: "chunk", stage, data })` — raw **LLM token** chunks at the **real stage number (0–6)**. Nothing is ever sent at `-1`.

So the AI cloud log must be built from `stageProgress[0..6].chunks` (grouped + joined), and it will be **raw-token output**, not the curated status lines the import flow shows. There is no status-text callback in the staged pipeline today, so producing import-style curated lines would require a deeper server change — out of scope here. The verbose log is therefore the **lowest-confidence** part of this plan; the live dots/detail mirroring and the layout/footer work are the solid wins.

## Plan (4 files modified, 1 file created)

### 1. `useStagedManifestGeneration.ts` — live cloud mirroring + verboseLog

- Add `verboseLog: string[]` state; clear it both at generation start (alongside the other `setX` resets, ~line 93) **and** in `reset()` (line 250). Add `verboseLog` to `UseStagedManifestGenerationReturn` and the returned object.
- Add a `useEffect` that mirrors the cloud stream while it runs (pattern from `useStagedSpecGeneration.ts:118-132`), so the dots/detail update live instead of only after `cloudStream.generate()` resolves:
  - `if (!cloudStream.isGenerating) return;`
  - `setPhase(cloudStream.phase)`, `setStepDetail(cloudStream.stepDetail)` (guard empty).
  - For the dots: strip key `-1` (defensive — none expected here) and `setStageProgress(numberedStages)`.
  - For the log: **group + join** chunks across numbered stages in ascending order so raw tokens read as text rather than one-token-per-line. Push a `Stage N — <label>` header per stage (`ThinkingBlock`'s `parseLogEntry` already renders `/^Stage \d/` as a header), then the joined chunk text split on `\n`. `setVerboseLog(...)`.
- **Local WebLLM path: do not build a verbose log.** Its use-case methods only expose `onProgress(detail)` (lines 128/148), and those strings already drive `setStepDetail` → shown in `ThinkingBlock`'s `DetailLine`. A second copy would be redundant. Leave `verboseLog` empty for local (the panel self-hides when empty). Revisit only if the client use case gains a token-level `onChunk`.

### 2. Create `GenerateWithAi/AiGeneratingStep.tsx` — dedicated generation view

Mirror `import-project-spec/ManifestGeneratingStep.tsx`:

- "Generating Manifest" heading (`shrink-0`).
- Error banner (`generationError` prop) — kept for completeness, though step 3 means an in-flight error usually falls back to the form (see below).
- `ThinkingBlock` inside `flex-1 min-h-0`, with `verboseLog` wired and **no** `stageLabels` prop (use `ThinkingBlock`'s built-in AI labels — `ThinkingBlock.tsx:18-29`).
- Wrap in `<Suspense>` with the same `<Skeleton>` fallback the import step uses.

### 3. `GenerateWithAi.tsx` — switch layout while generating (and only then)

- **Gate the swap on `flowState.state === "generating" && !stagedGen.generationError`**, not on `flowState.state === "generating"` alone. This is the key fix that avoids a UX regression: on error the swap turns off and execution falls back to the existing return, which renders the inline error block with **"Try Again (N attempts left)"** / **"Clear & Start Over"** and the `retryCount` cap (lines 271-320). Those affordances would be orphaned if we swapped unconditionally (and `ThinkingBlock` renders `null` on `phase === "failed"`, so the swapped screen would be nearly empty).
- Add an early `return` for the generating screen **after all hooks** (place it next to the existing `StateView` early return at line 218 / before the `engineStatus` block at 234), rendering `AiGeneratingStep` in `h-full flex flex-col dot-grid bg-ambient p-4`.
- Rework the existing `onGeneratingStateChange` effect (lines 60-62) to publish a **cancel action**, not a bare boolean, so the shell footer can drive Cancel:
  ```ts
  useEffect(() => {
    const active =
      flowState.state === "generating" && !stagedGen.generationError;
    onGeneratingStateChange?.(active ? { onCancel: cancelRef.current } : null);
  }, [flowState.state, stagedGen.generationError, onGeneratingStateChange]);
  ```
  where `cancelRef.current = () => { actions.clearError(); stagedGen.reset(); }` — i.e. the **same** handler `ActionBar`'s Cancel already uses (lines 424-427), held in a ref for stable identity (same trick as `onUseManifestRef`/`handleRetryRef`).
- Because the swap removes the in-body `ActionBar`, the footer Cancel becomes the only cancel during generation — hence the plumbing above is mandatory, not optional.

### 4. `AIGenerationPage.tsx` — footer shows Cancel during generation

- Add `const [generatingActions, setGeneratingActions] = useState<GeneratingFooterActions | null>(null);` and pass `onGeneratingStateChange={setGeneratingActions}` to `GenerateWithAi` (currently unpassed — `AIGenerationPage.tsx:164-168`).
- Footer precedence in `renderFooter()`: `previewActions` → preview footer; else `generatingActions` → Cancel footer; else → current Back footer. Mirror the import GENERATING footer layout (`<span />` left, Cancel button right):
  ```tsx
  if (generatingActions) {
    return (
      <>
        <span />
        <Button variant="outline" onClick={generatingActions.onCancel}>
          Cancel
        </Button>
      </>
    );
  }
  ```
- No header change needed — `renderHeaderContent()` already shows "Generate with AI" when `previewActions` is null.
- Note: with the error→form fallback (step 3), there's no "Cancel"→"Go Back" relabel to replicate — the form's own retry/clear UI handles recovery, so the footer only needs Cancel while in-flight.

### 5. `GenerateWithAi/types.ts` — callback signature

- Change `onGeneratingStateChange?: (isGenerating: boolean) => void` →
  `onGeneratingStateChange?: (actions: GeneratingFooterActions | null) => void`.
- Add `export interface GeneratingFooterActions { onCancel: () => void; }` (mirrors the existing `PreviewFooterActions` pattern, lines 18-30).

## Files

| File                                                                        | Action | Description                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/features/manifest-generation/useStagedManifestGeneration.ts`      | Modify | `verboseLog` state (cleared at start + in `reset()`); live cloud-mirroring `useEffect`; group/join numbered-stage chunks into the log; local path leaves log empty              |
| `apps/web/features/manifest-generation/GenerateWithAi/AiGeneratingStep.tsx` | Create | Dedicated generation view (mirrors `ManifestGeneratingStep`); `ThinkingBlock` in `flex-1 min-h-0`, default AI labels                                                            |
| `apps/web/features/manifest-generation/GenerateWithAi/GenerateWithAi.tsx`   | Modify | Swap to full-height generating screen when `generating && !generationError`; publish `{ onCancel }` via `onGeneratingStateChange`; error falls back to existing inline retry UI |
| `apps/web/features/manifest-generation/GenerateWithAi/types.ts`             | Modify | `onGeneratingStateChange` now takes `GeneratingFooterActions \| null`; add the interface                                                                                        |
| `apps/web/features/manifest-generation/AIGenerationPage.tsx`                | Modify | Track `generatingActions`; footer precedence preview → Cancel → Back                                                                                                            |

## Open decisions / risks

- **Verbose-log value (lowest confidence).** Cloud shows raw tokens (grouped per stage); local shows nothing extra. If raw tokens read poorly in testing, options are: (a) ship as-is, (b) drop the cloud log too and keep only the live dots/detail, or (c) larger server change to emit curated status text at stage `-1` from the staged pipeline. Recommend starting with (a) and reassessing on screen.
- **Model-loading portal** (`GenerateWithAi.tsx:366-400`) won't render under the swapped screen, but the AI flow only reaches `generating` once the model is ready (`handleGenerate` otherwise routes to model selection), so this is fine.
- **Tests:** no existing tests reference `ThinkingBlock`/`ActionBar`/`onGeneratingStateChange` directly, so breakage risk is low — but confirm the integration/e2e AI-flow tests don't assert form fields are present during generation, since the swap hides them.
