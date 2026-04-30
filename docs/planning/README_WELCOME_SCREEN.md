# Welcome Screen Integration — Documentation Index

This folder contains the complete, atomically-phased development plan for integrating the AI-powered manifest generation welcome screen into the HexaGen Monaco project workspace.

## 📄 Documents

### 1. **welcome-screen-integration-plan.md** (Main Plan — 806 lines)

Comprehensive specification including:
- **Feature Overview** — What, why, when
- **System Invariants** — Non-negotiable constraints
- **Phase 0–6** — Detailed deliverables, agent delegation, acceptance criteria
- **Timeline** — 9.5 hours total effort
- **Risk Mitigation** — Known risks and strategies
- **Success Criteria** — Feature completion checklist
- **Rollback Plan** — If things go wrong

**Read this first for complete detail and decision-making context.**

### 2. **WELCOME_SCREEN_PHASES.md** (Visual Reference — 261 lines)

Quick reference with diagrams:
- **System Context** — ASCII diagram of ProjectWorkspace layout
- **Phase Execution Flow** — Flowchart showing all 6 phases
- **Component Dependency Graph** — How pieces wire together
- **Data Flow (Happy Path)** — Step-by-step user journey
- **Phase Sequencing** — Dependencies between phases
- **Gating Criteria** — Quality gates between phases
- **Architecture Decisions** — Why we chose certain patterns

**Use this for understanding relationships and quick lookup during development.**

### 3. **README_WELCOME_SCREEN.md** (This file — Navigation)

High-level overview and document index.

---

## 🎯 Quick Start

### For Project Managers / Reviewers

1. Read **welcome-screen-integration-plan.md** → System Invariants, Timeline, Success Criteria
2. Reference **WELCOME_SCREEN_PHASES.md** → Phase Execution Flow, Phase Dependencies

### For Developers

1. Skim **welcome-screen-integration-plan.md** → Your assigned phase(s)
2. Read **WELCOME_SCREEN_PHASES.md** → Component Dependency Graph, Data Flow
3. Use **welcome-screen-integration-plan.md** → Detailed deliverables for your phase

### For QA / Testing

1. Read **welcome-screen-integration-plan.md** → Phase 3 (Error Handling) and Phase 6 (QA)
2. Reference **WELCOME_SCREEN_PHASES.md** → Risk & Mitigation Summary

---

## 📋 Phase Summary

| Phase     | Agent Type             | Duration | Complexity | Gating                                |
| --------- | ---------------------- | -------- | ---------- | ------------------------------------- |
| 0         | N/A                    | Trivial  | —          | ✓ Already complete                    |
| 1         | Domain Worker (UI)     | 1.5h     | Low        | `yarn build && yarn typecheck`        |
| 2         | Domain Worker (Logic)  | 2h       | Medium     | `yarn test` (parsing)                 |
| 3         | QA Worker (Testing)    | 1.5h     | Medium     | Integration tests pass                |
| 4         | Domain Worker (Orch.)  | 2h       | High       | Lifecycle tests pass                  |
| 5         | Domain Worker (Logic)  | 1.5h     | Medium     | Unit tests pass                       |
| 6         | QA Worker (Validation) | 1h       | Low        | Full quality gate + manual smoke test |
| **Total** | —                      | **9.5h** | —          | PR Ready ✓                            |

---

## 🔑 Key Decisions (Baked Into Plan)

1. **Entry Point:** "✨ Generate Manifest from AI" menu option in HeaderMenu
2. **Dialog:** Full-screen modal (`WelcomeManifestDialog`)
3. **Flow:** Generate → Preview → "Use This Manifest" → Load into wizard
4. **Landing Step:** First incomplete step (or summary if all complete)
5. **Save/Discard:** If editing existing project, triggers save/discard dialog first
6. **Editability:** Generated steps show visual hints but remain fully editable
7. **Parsing:** Full YAML → WizardFormData with schema validation
8. **Error Handling:** User-friendly messages, 15s timeout, exponential backoff retry

---

## 🏗️ System Context

```
┌─────────────────────────────────────────────┐
│         ProjectWorkspace                    │
│                                             │
│  Left Pane        Middle        Right Pane │
│  (Wizard)         (Canvas)      (AI)        │
│                                             │
│  + WelcomeManifestDialog (NEW)              │
│    └─ WelcomeScreen (existing)              │
│       ├─ useManifestGeneration              │
│       └─ /api/manifest/generate             │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 🔄 Data Flow (Happy Path)

```
User: "A task management app with teams"
    ↓
[✨ Generate from AI] button
    ↓
WelcomeScreen (input + examples)
    ↓
useManifestGeneration.generate() → /api/manifest/generate
    ↓
LLM (OpenAI / Anthropic)
    ↓
ManifestPreview (shows YAML + confidence)
    ↓
User: "Use This Manifest"
    ↓
parseGeneratedManifest(yaml) → WizardFormData
    ↓
form.reset(parsedData)
    ↓
analyzeManifestCompleteness() → landing step
    ↓
Wizard displays (ready to refine)
```

---

## ⚠️ System Invariants

These **cannot be violated** at any phase:

1. **INV-1** Welcome screen doesn't interrupt in-progress edits (save/discard first)
2. **INV-2** Generated manifest YAML fully parsed before wizard loads
3. **INV-3** All LLM requests traced with metadata
4. **INV-4** Parsing errors don't corrupt form state
5. **INV-5** Keyboard-accessible + dark mode support
6. **INV-6** Network errors handled gracefully (retry + friendly UX)

---

## 🚀 Next Steps (For User)

1. **Review this README** ✓
2. **Read main plan** → `welcome-screen-integration-plan.md`
3. **Confirm decisions** → Do all 8 decisions above align with your vision?
4. **Delegate Phase 1** → Send task to Domain Worker (UI)
5. **Track progress** → Each phase gates before next
6. **PR Review** → After Phase 6, ready for code review

---

## 📞 Questions?

- **Plan structure:** See `WELCOME_SCREEN_PHASES.md` → Phase Dependencies
- **Agent roles:** See main plan → Agent Delegation sections
- **Acceptance criteria:** See main plan → Each phase's Acceptance Criteria
- **Rollback:** See main plan → Rollback Plan section
- **Risks:** See `WELCOME_SCREEN_PHASES.md` → Risk & Mitigation Summary

---

**Plan Status:** ✅ Ready for Delegation  
**Created:** April 30, 2026  
**Total Effort:** ~9.5 hours (atomic, gated phases)  
**Worktree Path:** `/Users/martin/Projects/hexagen-monaco-worktrees/new-project-welcome-screen-integration-workspace`
