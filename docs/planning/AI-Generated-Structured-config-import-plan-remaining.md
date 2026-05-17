# Hexagen Monaco — Remaining Implementation Plan

> **Scope**: Completes gaps identified after implementing `AI-Generated-Structured-config-import-plan.md`
> **Prerequisite**: Read `DESIGN.md`, `AGENTS.md`, and the original plan before proceeding.

---

## Gap Summary

| Phase | Gap | Severity | Status |
|-------|-----|----------|--------|
| A5 | `ACCEPTED_EXTENSIONS` not named constant; `validateFile` not passed to FileDropZone | Low | Open |
| A7 | Missing `useGenerateWithAiForm` tests; missing `DescriptionInput` render tests | High | Open |
| B1 | Top-level import card label still "Import Manifest" not "Import" | Low | Open |
| B6 | Missing ImportSelectionPage tests; missing ImportManifestPage cancel tests | High | Open |
| C2 | Missing `spec-review`/`description-fallback` states; no `detectInputMode` usage; no `extractSpecSummary` usage; missing warning banner + fallback navigation | High | Open |
| C6 | Missing ImportProjectSpecPage render tests; missing `executeStructuredConfigGeneration` unit tests | Medium | Open |

---

## Intentional Deviations (Keep As-Is)

| Plan Spec | Actual Implementation | Rationale |
|-----------|----------------------|------------|
| `status: 'available' \| 'coming-soon'` | `isAvailable: boolean` | Simpler boolean; `ImportOptionRow` already works with `!option.isAvailable` |
| `detectInputMode` in `utils/detect-input-mode.ts` | Colocated in `creation-path.ts` | Avoids cross-feature import; only used in landing feature |
| `extractSpecSummary` colocated in page | Extracted to `utils/extract-spec-summary.ts` | Better reusability; has dedicated test file |

---

## Phase A5-Completion — DescriptionInput Polish

**Agent**: A-5  
**File**: `apps/web/features/manifest-generation/GenerateWithAi/DescriptionInput.tsx`  
**Blocked by**: nothing  
**Unblocks**: A7

### Change 1 — Add `ACCEPTED_EXTENSIONS` constant

At top of function body, after props destructuring:

```ts
const ACCEPTED_EXTENSIONS = ['.yaml', '.yml', '.toml', '.json', '.md', '.txt'];
```

### Change 2 — Implement `validateFile` function

```ts
const validateFile = (file: File): string | null => {
  const lower = file.name.toLowerCase();
  const ok = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  return ok
    ? null
    : `Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`;
};
```

### Change 3 — Pass `validateFile` and `accept` to FileDropZone

```tsx
<FileDropZone
  accept={ACCEPTED_EXTENSIONS.join(',')}
  validateFile={validateFile}
  onFileLoaded={(content, filename) => onFileLoaded?.(content, filename)}
  label="Upload a project config — click or drop to browse"
  hint={<>Drop a .yaml, .md, .txt, or .json config</>}
  className={loadedFileName ? "hidden" : "mb-0"}
/>
```

### Verification

```bash
cd apps/web && npx tsc --noEmit
grep -n "ACCEPTED_EXTENSIONS\|validateFile" \
  features/manifest-generation/GenerateWithAi/DescriptionInput.tsx
# Both must appear and be used
```

---

## Phase A7 — Tests: Workstream A

**Agent**: A-7  
**Files**:
- `apps/web/features/manifest-generation/GenerateWithAi/__tests__/useGenerateWithAiForm.test.ts`
- `apps/web/features/manifest-generation/GenerateWithAi/__tests__/DescriptionInput.test.tsx`

**Blocked by**: A5-Completion  
**Unblocks**: none  
**Test runner**: `npx tsx --test <path>` (bundler resolution)

### Test Suite: `useGenerateWithAiForm.test.ts`

| Test | Input | Assertion |
|------|-------|------------|
| `loadFromFile` sets description and filename atomically | `content = "x".repeat(1000)`, `filename = "spec.yaml"` | `formState.description === content`, `formState.loadedFileName === "spec.yaml"`, `formState.selectedExample === null` |
| `loadFromFile` truncates exceeding MAX | `content = "x".repeat(51000)` | `formState.description.length === 50000` |
| `loadFromFile` clears selectedExample | Start `selectedExample = 2`, call `loadFromFile(...)` | `formState.selectedExample === null` |
| `clearFile` resets description and filename | Load file, `clearFile()` | `formState.description === ""`, `formState.loadedFileName === null` |
| `clearFile` does not touch other fields | Set `deployment = "fly.io"`, load, `clearFile()` | `formState.deployment === "fly.io"` |
| `isValid` at exactly 50,000 chars | `description = "x".repeat(50000)` | `isValid === true` |
| `isValid` at 50,001 chars | `description = "x".repeat(50001)` | `isValid === false` |

### Test Suite: `DescriptionInput.test.tsx`

| Test | Setup | Assertion |
|------|-------|------------|
| Upload zone visible when no file loaded | `loadedFileName={null}` | FileDropZone in DOM |
| Upload zone hidden when file loaded | `loadedFileName="config.yaml"` | Wrapper has `hidden` class |
| Filename badge renders | `loadedFileName="config.yaml"` | Text "config.yaml" in DOM |
| Clear button calls `onClearFile` | Render with `loadedFileName="f.yaml"`, click × | `onClearFile` mock called once |
| Counter neutral below 90% | `charCount={40000}` | No amber/destructive class |
| Counter amber at 90%+ | `charCount={46000}` | Has amber class |
| Counter destructive at limit | `charCount={50000}` | Has destructive class |
| Counter has `aria-live="polite"` | Any render | `aria-live` attribute = `"polite"` |
| Helper text shown when too short | `charCount={5}` | "Minimum 10 characters required" in DOM |
| Helper text hidden when empty | `charCount={0}` | Helper text NOT in DOM |

---

## Phase B1-Completion — Domain Model Polish

**Agent**: B-1  
**File**: `apps/web/features/landing/domain/creation-path.ts`  
**Blocked by**: nothing  
**Unblocks**: B6

### Change — Update top-level import card label

In `CREATION_PATH_OPTIONS`, update the `"import"` entry:

```ts
// BEFORE
{
  id: "import",
  label: "Import Manifest",
  description: "Upload an existing manifest file...",
  ...
}

// AFTER
{
  id: "import",
  label: "Import",
  description: "Import an existing manifest, upload a structured domain spec, or connect a GitHub repository.",
  ...
}
```

### Decision: `isAvailable` vs `status`

**Recommendation**: Keep `isAvailable: boolean`. Changing to `status: 'available' | 'coming-soon'` requires updating `ImportSubOption` interface, all 3 entries in `IMPORT_SUB_OPTIONS`, and `ImportOptionRow.tsx`. The boolean is simpler and already works.

---

## Phase B6 — Tests: Workstream B

**Agent**: B-6  
**Files**:
- `apps/web/features/landing/components/__tests__/ImportOptionRow.test.tsx` (new)
- `apps/web/features/landing/__tests__/ImportSelectionPage.test.tsx` (new)
- `apps/web/features/manifest-generation/__tests__/ImportManifestPage.test.tsx` (new)

**Blocked by**: B3 (page exists), B4 (cancel fixed)  
**Unblocks**: none

### Test Suite: `ImportOptionRow.test.tsx`

| Test | Assertion |
|------|------------|
| Available row renders as `<button>` | Button element in DOM |
| Available row is clickable | Click navigates to `option.href` |
| Available row shows label + description + detail | All text in DOM |
| Coming-soon row renders as `<div>` with `role="presentation"` | Correct element |
| Coming-soon row NOT clickable | No `onClick` handler |
| Coming-soon has `cursor-not-allowed` | Class present |
| "Coming soon" badge renders | Text in DOM |

### Test Suite: `ImportSelectionPage.test.tsx`

| Test | Assertion |
|------|------------|
| Renders three `ImportOptionRow` instances | Count = 3 |
| Shows "Choose Import Type" heading | Heading in DOM |
| Back button navigates to `/projects/new` | `router.push("/projects/new")` |
| `CreationStepIndicator` renders | Component in DOM |

### Test Suite: `ImportManifestPage.test.tsx`

| Test | Assertion |
|------|------------|
| Cancel with no file → `/projects/new/import` | `router.push("/projects/new/import")` |
| Cancel with file loaded clears state | `manifestYaml` set to null, no navigation |

---

## Phase C2-Completion — ImportProjectSpecPage Full State Machine

**Agent**: C-2  
**File**: `apps/web/features/manifest-generation/ImportProjectSpecPage.tsx`  
**Blocked by**: C1 (`detectInputMode` in `creation-path.ts`), extracted `extractSpecSummary`  
**Unblocks**: C6

### Change 1 — Add Missing Phases

```ts
type Phase = 'upload' | 'spec-review' | 'description-fallback' | 'generating' | 'preview' | 'error';
```

### Change 2 — Use `detectInputMode` on Content Receive

Import from landing domain (or re-export from appropriate barrel):

```ts
import { detectInputMode } from '../landing/domain/creation-path';
// OR if re-exported: from '../landing/domain';
```

Wire to FileDropZone and textarea:

```ts
const handleContentReceived = (content: string, filename?: string) => {
  setRawConfig(content);
  setLoadedFileName(filename ?? null);
  
  const mode = detectInputMode(content);
  if (mode === 'structured-config') {
    setPhase('spec-review');
  } else {
    setPhase('description-fallback');
  }
};
```

### Change 3 — Spec Summary Panel (State: `spec-review`)

```tsx
import { extractSpecSummary } from '../utils/extract-spec-summary';
import yaml from 'js-yaml'; // confirm already dependency; if not: yarn add js-yaml

// In component:
const [specSummary, setSpecSummary] = useState<ReturnType<typeof extractSpecSummary> | null>(null);

// When entering spec-review:
if (phase === 'spec-review' && rawConfig) {
  try {
    const parsed = yaml.load(rawConfig) as Record<string, unknown>;
    setSpecSummary(extractSpecSummary(parsed));
  } catch {
    setPhase('description-fallback');
  }
}
```

Render:

```tsx
{phase === 'spec-review' && specSummary && (
  <div className="bg-card border border-card-border rounded-lg p-4 space-y-3">
    <h3 className="font-semibold text-foreground">Spec Summary</h3>
    <ul className="text-sm text-muted-foreground space-y-1">
      <li>✓ {specSummary.contextCount} bounded contexts detected</li>
      <li>✓ {specSummary.aggregateCount} aggregates · {specSummary.valueObjectCount} value objects</li>
      <li>✓ {specSummary.useCaseCount} use cases</li>
      <li>✓ {specSummary.mappingCount} context mappings</li>
      {specSummary.eventBusSubscriptionCount > 0 && (
        <li>✓ Event bus: {specSummary.eventBusSubscriptionCount} subscriptions</li>
      )}
    </ul>
    <p className="text-xs text-muted-foreground">
      AI will generate: ports, adapters, manifest assembly, validation
    </p>
    <p className="text-xs text-muted-foreground">
      AI will skip: domain derivation (Stages 0–2), context classification
    </p>
    <Button onClick={() => setPhase('generating')}>Map Ports & Adapters</Button>
  </div>
)}
```

### Change 4 — Description Fallback UI (State: `description-fallback`)

```tsx
{phase === 'description-fallback' && (
  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
    <p className="text-sm font-medium text-amber-800">
      This content doesn't look like a structured spec.
    </p>
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => {
        router.push(`/projects/new/ai?prefill=${encodeURIComponent(rawConfig)}`);
      }}>
        Generate with AI instead
      </Button>
      <Button onClick={() => setPhase('generating')}>
        Continue anyway (uses full pipeline)
      </Button>
    </div>
  </div>
)}
```

### Change 5 — Back Navigation

Both `spec-review` and `description-fallback` Back buttons → `/projects/new/import`.

---

## Phase C6-Completion — Tests: Workstream C

**Agent**: C-6  
**Files**:
- `apps/web/features/manifest-generation/__tests__/ImportProjectSpecPage.test.tsx` (new)
- `packages/agentic-interaction/__tests__/application/use-cases/execute-structured-config-generation.test.ts` (new)

**Blocked by**: C2-Completion, C3 (use case exists)

### Test Suite: `ImportProjectSpecPage.test.tsx`

| Test | Assertion |
|------|------------|
| Initial state shows FileDropZone | Upload zone in DOM |
| Structured config → `spec-review` | Phase transitions correctly |
| Non-structured → `description-fallback` | Phase transitions correctly |
| Spec summary shows correct counts | Matches `extractSpecSummary` output |
| "Back" in spec-review → `/projects/new/import` | Navigation correct |
| "Generate with AI instead" → `/projects/new/ai` | Navigation with prefill param |
| Warning banner in description-fallback | Warning text in DOM |
| "Continue anyway" → `generating` phase | Phase update |

### Test Suite: `executeStructuredConfigGeneration.test.ts`

| Test | Assertion |
|------|------------|
| Returns PipelineState with non-null assembledManifest | Valid config input |
| Makes exactly 4 LLM calls (Stages 3-6) | Mock adapter, count calls |
| `onProgress` called with stages 0-6 | All stages reported |
| Skips Stages 0-2 LLM calls | No LLM calls for 0-2 |
| Handles invalid YAML gracefully | No crash, returns error |
| Returns error result on LLM failure | Mock failure, check result |

---

## Dependency Graph

```
A5-Completion ──────────► A7
B1-Completion ──────────► B6
C1 (done) ─► C2-Completion ─► C6
C3 (done) ─────────────────┘
```

---

## Rollout Table

| Order | Phase | Blocked by | Sprint |
|-------|-------|------------|--------|
| 1 | A5-Completion | nothing | 3 |
| 1 | B1-Completion | nothing | 3 |
| 2 | A7 | A5 | 3 |
| 2 | B6 | B1 | 3 |
| 2 | C2-Completion | C1 (done), extractSummary (done) | 3 |
| 3 | C6 | C2, C3 (done) | 3 |

---

## Pre-Merge Gate (run after every phase)

```bash
yarn build && yarn typecheck && yarn lint && yarn test
# All 4 commands must exit 0
```
