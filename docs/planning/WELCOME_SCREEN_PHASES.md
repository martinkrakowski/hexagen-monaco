# Welcome Screen Integration — Phase Overview (Visual)

## System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ProjectWorkspace                              │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │   Left Pane      │    │ Middle Pane  │    │  Right Pane    │  │
│  │  (Wizard Steps)  │    │ (Architecture)│   │  (Governance)  │  │
│  │  ┌────────────┐  │    │              │    │                │  │
│  │  │ Step 1: WG │  │    │   Canvas     │    │  AI Assistant  │  │
│  │  │ Step 2: BC │  │    │              │    │                │  │
│  │  │ Step 3: PM │  │    │   or Code    │    │                │  │
│  │  │ Step 4: P  │  │    │              │    │                │  │
│  │  │ Step 5: SU │  │    │              │    │                │  │
│  │  └────────────┘  │    │              │    │                │  │
│  │                  │    │              │    │                │  │
│  │  [SavedProjects] │    │              │    │                │  │
│  │  (if viewing)    │    │              │    │                │  │
│  └──────────────────┘    └──────────────┘    └────────────────┘  │
│                                                                     │
│  Dialogs (Overlays):                                               │
│  • LoadManifestDialog (existing)                                  │
│  • ResumeDraftDialog (existing)                                   │
│  • NewProjectConfirmDialog (existing)                             │
│  • WelcomeManifestDialog (NEW — Phase 1)                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Phase Execution Flow

```
                    ┌─────────────────────────────────┐
                    │  Phase 0: Dependencies (Trivial) │
                    │  ✓ Already met — NO WORK        │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │ Phase 1: Dialog State & Routing │
                    │ Agent: Domain Worker (UI)       │
                    │ Duration: 1.5 hours             │
                    │ Output: WelcomeManifestDialog   │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │ Phase 2: Manifest Parsing        │
                    │ Agent: Domain Worker (Logic)    │
                    │ Duration: 2 hours               │
                    │ Output: parseGeneratedManifest()│
                    │         + useManifestParser()   │
                    │         + tests                 │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │ Phase 3: Error Handling         │
                    │ Agent: QA Worker (Testing)      │
                    │ Duration: 1.5 hours             │
                    │ Output: Error messages          │
                    │         + Retry logic           │
                    │         + Integration tests     │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │ Phase 4: Lifecycle Integration  │
                    │ Agent: Domain Worker (Orch.)    │
                    │ Duration: 2 hours               │
                    │ Output: handleWelcomeManifest   │
                    │         + Save/Discard flow    │
                    │         + Form hydration       │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │ Phase 5: Wizard Navigation      │
                    │ Agent: Domain Worker (Logic)    │
                    │ Duration: 1.5 hours             │
                    │ Output: analyzeCompleteness()   │
                    │         + Smart step landing    │
                    │         + Read-only UI          │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │ Phase 6: Docs & QA             │
                    │ Agent: QA Worker (Validation)   │
                    │ Duration: 1 hour                │
                    │ Output: Documentation           │
                    │         + Quality gate pass     │
                    │         + Ready for PR          │
                    └─────────────────────────────────┘
```

## Component Dependency Graph (Post-Implementation)

```
                    useWorkspaceShellUi()
                    (dialog state: "welcome-manifest")
                            │
                            ├─► HeaderMenu
                            │   └─► [✨ Generate from AI]
                            │
                            └─► ProjectWorkspace
                                └─► WelcomeManifestDialog (NEW)
                                    ├─► WelcomeScreen (existing)
                                    │   ├─► useManifestGeneration (existing)
                                    │   │   └─► /api/manifest/generate (existing)
                                    │   └─► Textarea, Button, etc.
                                    │
                                    └─► onManifestGenerated
                                        └─► useProjectLifecycle.handleWelcomeManifestGenerated (NEW)
                                            ├─► parseGeneratedManifest() (NEW)
                                            ├─► form.reset()
                                            └─► ui.closeDialog()
                                                └─► analyzeManifestCompleteness() (NEW)
                                                    └─► ui.setCurrentStepIndex()
```

## Data Flow (Happy Path)

```
User Input (Natural Language)
        │
        ▼
[✨ Generate from AI] button in HeaderMenu
        │
        ├─► ui.openDialog({ kind: "welcome-manifest" })
        │
        ▼
WelcomeManifestDialog opens
        │
        ├─► WelcomeScreen renders
        │
        ├─► User enters: "A task mgmt system with teams"
        │
        ├─► handleGenerate() calls useManifestGeneration.generate()
        │
        ├─► fetch /api/manifest/generate (with description)
        │
        ▼
CloudLLMPipelineAdapter (OpenAI → Anthropic fallback)
        │
        ├─► GenerateManifestFromDescriptionUseCase.execute()
        │
        ▼
LLM Response (YAML manifest)
        │
        ├─► ManifestPreview shows with confidence score
        │
        ├─► User clicks "Use This Manifest"
        │
        ├─► onUseManifest(manifestYaml) fires
        │
        ▼
lifecycle.handleWelcomeManifestGenerated(manifestYaml)
        │
        ├─► Check: isEditing?
        │   ├─ YES: open NewProjectConfirmDialog with pending manifest
        │   └─ NO: continue to parsing
        │
        ├─► parseGeneratedManifest(manifestYaml)
        │
        ├─► Validate YAML against schema
        │
        ├─► Map YAML → WizardFormData
        │
        ▼
form.reset(parsedFormData)
        │
        ├─► Form hydration complete
        │
        ├─► analyzeManifestCompleteness(formData)
        │
        ├─► Determine first incomplete step
        │
        ├─► ui.setCurrentStepIndex(firstIncompleteStep || summary)
        │
        ├─► ui.closeDialog()
        │
        ▼
Wizard displays with pre-filled data
        │
        ├─► User can refine any step
        │
        ├─► Navigation enabled
        │
        └─► Ready to save project
```

## Phase Dependencies (Sequencing)

```
Phase 0 (Trivial)
    ↓ [no dependencies — ready immediately]
Phase 1 (Dialog State)
    ↓ [must exist before parsing can be wired]
Phase 2 (Manifest Parsing)
    ↓ [must exist before lifecycle integration]
Phase 3 (Error Handling)
    ├─ Can develop in parallel with Phase 2 (shared error context)
    ↓
Phase 4 (Lifecycle Integration)
    ↓ [depends on Phases 1, 2, 3]
Phase 5 (Wizard Navigation)
    ↓ [depends on Phase 4, enhances Phase 5]
Phase 6 (Docs & QA)
    ↓ [depends on ALL previous phases]
✓ Feature Complete & Ready for PR
```

## Gating Criteria Between Phases

| From         | To                                                 | Gate Check           |
| ------------ | -------------------------------------------------- | -------------------- |
| Phase 0 → 1  | Explicit (all deps present)                        | —                    |
| Phase 1 → 2  | `yarn build && yarn typecheck && yarn lint` passes | TypeScript integrity |
| Phase 2 → 3  | `yarn test` passes (parsing tests)                 | Logic correctness    |
| Phase 3 → 4  | Integration tests pass (error scenarios)           | Resilience verified  |
| Phase 4 → 5  | Lifecycle tests pass (form hydration)              | State integrity      |
| Phase 5 → 6  | All unit tests pass                                | Logic completeness   |
| Phase 6 → PR | Full quality gate + manual smoke test              | Release ready        |

## Architecture Decisions

### Decision 1: Modal Dialog vs. Inline
**Chosen:** Modal Dialog (`WelcomeManifestDialog`)

- **Rationale:** Immersive, focused UX; doesn't disrupt wizard layout
- **Alternative:** Replace left pane temporarily (more complex routing)

### Decision 2: One-Step or Two-Step Manifest Load
**Chosen:** Single "Use This Manifest" → Direct Load

- **Rationale:** User sees preview, clicks use → loads directly
- **Alternative:** Show preview dialog, then separate "Import" step (extra friction)

### Decision 3: Auto-Complete Behavior
**Chosen:** Read-only hints + full editability

- **Rationale:** Show which steps were auto-generated, user can still refine
- **Alternative:** Fully locked steps (restrictive) or fully editable without hints (confusing)

### Decision 4: Landing Step
**Chosen:** First incomplete step (or summary if all complete)

- **Rationale:** Encourages refinement; summary available for review
- **Alternative:** Always land on step 1 (ignores completeness); always summary (skips refinement)

---

## Risk & Mitigation Summary

| Risk                                       | Mitigation                              | Phase   |
| ------------------------------------------ | --------------------------------------- | ------- |
| YAML parsing edge cases                    | Comprehensive test coverage             | Phase 2 |
| LLM timeout / poor UX                      | 15s timeout + exponential backoff retry | Phase 3 |
| Form state corruption                      | Immutable reset + validation            | Phase 4 |
| Race condition (click while generating)    | Disable button during generation        | Phase 1 |
| User confusion (auto-generated vs. manual) | Visual hints + read-only markers        | Phase 5 |

---

**Document Created:** April 30, 2026  
**Status:** Ready for Phase 1 Delegation  
**Total Effort:** ~9.5 hours (atomic, gated phases)
