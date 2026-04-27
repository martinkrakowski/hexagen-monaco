# DATA FLOW CARTOGRAPHY — HexaGen Monaco System

**Date:** 2026-04-27
**Mission Status:** COMPLETE
**Critical Finding:** Flow 3 (Accept/Reject) is architecturally broken, invalidating A2UI assumptions

---

## EXECUTIVE SUMMARY

### Verdict Summary

- **Flow 1 (NL Input → Manifest Mutation):** RISK — 5 systemic issues
- **Flow 2 (Manifest Read → UI Render):** CLEAN — No issues
- **Flow 3 (Patch Accept/Reject):** BROKEN — Endpoints are no-ops

### Critical Blocker for A2UI

**The accept/reject endpoints are logging-only stubs. Patches are applied to the manifest BEFORE user review, not after.** This invalidates the core A2UI assumption that users can review and veto AI-generated changes before they mutate the manifest.

**Impact:** A2UI Phases 2–5 cannot proceed as designed without fixing Flow 3 first.

---

## FLOW 1: NL Input → Manifest Mutation

### Entry → Exit

**Entry:** [`useArchitectureModification.ts:86`](apps/web/features/governance-assistant/hooks/useArchitectureModification.ts:86) → `fetch("/api/architecture/modify/stream")`
**Exit:** Manifest written to `.architecture/manifest.yaml` + SSE stream closed + UI state updated

### Critical Path (12 Stages)

1. **Client Hook** → POST to `/api/architecture/modify/stream` with `{intent, manifestPath?, lineage?}`
2. **API Route** → Validate input, create SSE stream ([`route.ts:39-108`](apps/web/app/api/architecture/modify/stream/route.ts:39-108))
3. **Use Case Wiring** → Wire dependencies ([`wire.server.ts:136-203`](apps/web/app/lib/wire.server.ts:136-203))
4. **Pipeline Execution** → 5 steps: parse → compile → LLM → reconcile → commit ([`use-case.ts:73-182`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:73-182))
5. **Reconciliation** → Generate patches, filter by lint violations ([`reconcile.use-case.ts:21-65`](packages/reconciliation-engine/src/application/use-cases/reconcile.use-case.ts:21-65))
6. **Transaction Begin** → Create transaction, transition to "speculative" ([`use-case.ts:298-302`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:298-302))
7. **Manifest Mutation** → Apply patches to manifest **BEFORE user review** ([`use-case.ts:304-307`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:304-307))
8. **Disk Write** → `fs.writeFile()` to `.architecture/manifest.yaml` ([`manifest-service.ts:84`](packages/sync/src/manifest-service.ts:84))
9. **Lint Validation** → `execSync("yarn lint:arch")` **BLOCKING** ([`manifest-service.ts:54`](packages/sync/src/manifest-service.ts:54))
10. **Rollback on Lint Fail** → `git checkout -- manifest.yaml` if lint fails ([`use-case.ts:122-156`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:122-156))
11. **Transaction Commit** → Transition to "committed" ([`use-case.ts:335`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:335))
12. **SSE Events** → Stream progress to client, close on completion ([`route.ts:111-154`](apps/web/app/api/architecture/modify/stream/route.ts:111-154))

### Critical Error Paths

| Error                 | Location                                                                                                                        | Recovery              | Risk                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------- |
| **Git restore fails** | [`use-case.ts:123-146`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:123-146)         | Return critical error | **UNRECOVERABLE** — manifest corrupted |
| **Patch apply fails** | [`use-case.ts:308-333`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:308-333)         | Attempt git restore   | If restore fails: **UNRECOVERABLE**    |
| **Lint fails**        | [`use-case.ts:122-156`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:122-156)         | Attempt git restore   | If restore fails: **UNRECOVERABLE**    |
| **Client aborts**     | [`useArchitectureModification.ts:199-202`](apps/web/features/governance-assistant/hooks/useArchitectureModification.ts:199-202) | Set status: "idle"    | Server continues executing (wasteful)  |

### Async Boundaries

| Boundary        | Type                  | Timeout         | Abort              | Risk                              |
| --------------- | --------------------- | --------------- | ------------------ | --------------------------------- |
| Client → Server | HTTP POST             | Browser default | ✅ AbortController | Low                               |
| SSE Stream      | ReadableStream        | None            | ❌ No heartbeat    | **HIGH** — can break mid-pipeline |
| LLM API         | HTTP                  | 60s             | ✅ AbortController | Medium                            |
| File I/O        | fs.readFile/writeFile | None            | ❌                 | Medium                            |
| Git Restore     | execSync              | None            | ❌ **BLOCKING**    | **HIGH** — can hang indefinitely  |
| Lint            | execSync              | None            | ❌ **BLOCKING**    | **HIGH** — can hang indefinitely  |

### Verdict: RISK

**Issues:**

1. ⚠️ Git restore failure → unrecoverable manifest corruption
2. ⚠️ Blocking `execSync` calls can hang server thread
3. ⚠️ No retry logic for transient failures
4. ⚠️ SSE stream can break mid-pipeline
5. ⚠️ Client abort doesn't stop server execution

---

## FLOW 2: Manifest Read → UI Render

### Entry → Exit

**Entry:** [`page.tsx:10`](apps/web/app/page.tsx:10) → `<ProjectWorkspace />`
**Exit:** UI rendered from client-side form state

### Critical Path (4 Stages)

1. **Page Load** → Render `<ProjectWorkspace />` ([`page.tsx:10`](apps/web/app/page.tsx:10))
2. **Hook Init** → `useWizardForm()`, `useWorkspaceShellUi()`, etc. ([`ProjectWorkspace.tsx:32-44`](apps/web/features/workspace-shell/ProjectWorkspace.tsx:32-44))
3. **Form State** → React Hook Form + local storage (no server fetch)
4. **Preview Render** → `<ArchitecturePreviewPane wizardData={wizardData} />` ([`ProjectWorkspace.tsx:100-110`](apps/web/features/workspace-shell/ProjectWorkspace.tsx:100-110))

**User Action (Optional):** Load manifest → File picker → Client-side YAML parse → Populate form

### Verdict: CLEAN

**Rationale:**

- ✅ No server dependency for initial render
- ✅ Client-side validation before submission
- ✅ No stale data risk
- ✅ Fast initial page load

---

## FLOW 3: Patch Accept/Reject → State Transition

### Entry → Exit

**Entry:** [`useArchitectureModification.ts:229`](apps/web/features/governance-assistant/hooks/useArchitectureModification.ts:229) → `acceptPatch(patch)` or [`line 248`](apps/web/features/governance-assistant/hooks/useArchitectureModification.ts:248) → `rejectPatch(patch)`
**Exit:** HTTP 200 with `{success: true, status: "accepted"/"rejected"}` — **NO ACTUAL STATE CHANGE**

### Accept Flow (3 Stages)

1. **Client Hook** → POST to `/api/architecture/modify/accept` with `{transactionId, patches}`
2. **API Route** → Validate `transactionId` presence ([`accept/route.ts:9-14`](apps/web/app/api/architecture/modify/accept/route.ts:9-14))
3. **Logging Only** → `logger.info()` + return success ([`accept/route.ts:16-26`](apps/web/app/api/architecture/modify/accept/route.ts:16-26))

**What's Missing:**

```typescript
// Should be at accept/route.ts:16-26
const transactionManager = getTransactionManager();
const transaction = transactionManager.get(transactionId);
if (!transaction || transaction.status !== "committed") {
  return NextResponse.json(
    { success: false, error: "Invalid transaction" },
    { status: 400 },
  );
}
const updatedTx = transactionManager.transition(transactionId, "accepted");
return NextResponse.json({
  success: true,
  transactionId,
  status: updatedTx.status,
});
```

### Reject Flow (3 Stages)

1. **Client Hook** → POST to `/api/architecture/modify/reject` with `{transactionId, patches, reason}`
2. **API Route** → Validate `transactionId` presence ([`reject/route.ts:9-14`](apps/web/app/api/architecture/modify/reject/route.ts:9-14))
3. **Logging Only** → `logger.info()` + return success ([`reject/route.ts:16-28`](apps/web/app/api/architecture/modify/reject/route.ts:16-28))

**What's Missing:**

```typescript
// Should be at reject/route.ts:16-28
const transactionManager = getTransactionManager();
const manifestMutation = getManifestMutation();
const transaction = transactionManager.get(transactionId);
if (!transaction || transaction.status !== "committed") {
  return NextResponse.json(
    { success: false, error: "Invalid transaction" },
    { status: 400 },
  );
}
const rolledBackTx = transactionManager.rollback(transactionId, reason);
const manifestPath = path.join(process.cwd(), ".architecture/manifest.yaml");
const restoreResult = await manifestMutation.restoreFromGit(manifestPath);
if (!restoreResult.success) {
  return NextResponse.json(
    { success: false, error: "Rollback succeeded but restore failed" },
    { status: 500 },
  );
}
return NextResponse.json({
  success: true,
  transactionId,
  status: rolledBackTx.status,
  manifestRestored: true,
});
```

### Verdict: BROKEN

**Issues:**

1. ❌ Accept endpoint is a no-op (logging only)
2. ❌ Reject endpoint is a no-op (logging only)
3. ❌ No transaction state transition
4. ❌ No manifest restoration on reject
5. ❌ Patches already applied in Flow 1 (before user review)
6. ❌ Transaction remains "committed" regardless of user action

**Root Cause:** Endpoints were scaffolded but never implemented. The transaction system supports the required state transitions, but the API routes don't call them.

---

## A2UI CONFLICT ANALYSIS

### Core Assumption Violated

**A2UI Assumption:** Users can review AI-generated commands and accept/reject them before manifest mutation.

**Actual Reality:** Patches are applied to the manifest immediately in Flow 1 (Stage 7), before the user sees them. The accept/reject endpoints are logging-only no-ops.

### A2UI Plan Sections Affected

| Section                            | Line    | Assumption                                             | Conflict                                |
| ---------------------------------- | ------- | ------------------------------------------------------ | --------------------------------------- |
| **1.1–1.3 (Wizard Auto-Fill)**     | 150     | User clicks "Apply auto-fill" → review → accept/reject | Manifest mutates immediately, no undo   |
| **2.1 (Canvas Node Manipulation)** | 260–274 | `executeCommand()` → review → accept/reject            | Commands execute immediately, no review |
| **3.1 (Monaco Editor Editing)**    | 422–445 | `executeCommand()` → review → accept/reject            | Edits apply immediately, no veto        |
| **Appendix B (Migration Path)**    | 949     | "A2UI is additive, not replacement"                    | False — conflicts with broken Flow 3    |

---

## TWO PATHS FORWARD

### Option A: Fix Flow 3 First (Recommended)

**Prerequisite for user-review-based A2UI**

#### Tasks

1. **Implement Accept Endpoint** ([`accept/route.ts`](apps/web/app/api/architecture/modify/accept/route.ts))
   - Wire `transactionManager` from `wire.server.ts`
   - Validate transaction exists and is in "speculative" state
   - **Move patch application from Flow 1 to here**
   - Apply patches → lint → commit transaction
   - If lint fails: rollback + restore from git

2. **Implement Reject Endpoint** ([`reject/route.ts`](apps/web/app/api/architecture/modify/reject/route.ts))
   - Wire `transactionManager` and `manifestMutation`
   - Validate transaction exists and is in "speculative" state
   - Rollback transaction
   - Restore manifest from git
   - Validate restore succeeded

3. **Redesign Flow 1** ([`modify-architecture.use-case.ts`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts))
   - Stop pipeline at reconciliation (patches generated, not applied)
   - Return patches + transaction ID to client
   - Client shows patches for review
   - User clicks accept → triggers accept endpoint → patches applied
   - User clicks reject → triggers reject endpoint → patches discarded

4. **Update A2UI Plan**
   - Assume user-review-before-mutation model
   - Add review UI components for all command types

**Cost:** ~3 days
**Timeline:** Do this before Phase 1 of A2UI
**Risk:** Low — aligns with existing transaction system design

---

### Option B: Redesign A2UI for Auto-Apply (Status Quo)

**Work around Flow 3 being broken**

#### Tasks

1. **Accept Immediate Mutation**
   - Manifests mutate automatically on A2UI command execution
   - No pre-review, only post-undo

2. **Implement Undo-Only Review**
   - A2UI executes command → manifest mutates → user sees undo button
   - Undo button calls `manifestMutation.restoreFromGit()`
   - No accept/reject, only undo

3. **Remove Pre-Review Loops from A2UI Plan**
   - Section 1.4 (Wizard Chat): Don't ask "confirm auto-fill?" — just do it + show undo
   - Section 2.1 (Canvas): Don't ask "confirm add node?" — just do it + show undo
   - Section 3.1 (Editor): Don't ask "confirm edit?" — just do it + show undo

4. **Update Phase 1 of A2UI**
   - Replace "command validation layer" (line 562–565) with "undo mechanism"
   - Add undo button to all A2UI interactions

**Cost:** ~2 days (simpler)
**Timeline:** Can start immediately
**Risk:** Medium — users cannot prevent unwanted mutations, only undo after

---

## RECOMMENDATIONS

### Immediate Actions (Flow 3)

1. **URGENT:** Implement accept/reject endpoints (Option A, tasks 1–2)
2. **URGENT:** Redesign Flow 1 to stop before mutation (Option A, task 3)
3. **URGENT:** Update A2UI plan to reflect chosen approach (Option A or B)

### Flow 1 Risk Mitigation (Parallel Work)

1. Replace `execSync` with async `exec` + timeout
2. Add retry logic for transient failures (3 attempts, exponential backoff)
3. Implement SSE heartbeat to detect broken connections
4. Add transaction recovery mechanism for git restore failures
5. Add cancellation support for use case execution

### Decision Point

**Which direction?**

1. `delegate architecture-refactor [option-a]` — Fix Flow 3 + Flow 1 first, then proceed with user-review A2UI
2. `develop a2ui-phase-1 [option-b]` — Redesign A2UI for auto-apply + undo (faster, riskier)
3. `brainstorm hybrid` — Mix both approaches (e.g., wizard = auto-apply, canvas = review-before-apply)

---

## APPENDIX: File References

### Flow 1 Key Files

- [`apps/web/app/api/architecture/modify/stream/route.ts`](apps/web/app/api/architecture/modify/stream/route.ts) — SSE endpoint
- [`apps/web/app/lib/wire.server.ts`](apps/web/app/lib/wire.server.ts) — Dependency wiring
- [`packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts`](packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts) — Pipeline orchestration
- [`packages/reconciliation-engine/src/application/use-cases/reconcile.use-case.ts`](packages/reconciliation-engine/src/application/use-cases/reconcile.use-case.ts) — Patch generation
- [`packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts`](packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts) — Manifest mutation
- [`packages/sync/src/manifest-service.ts`](packages/sync/src/manifest-service.ts) — Manifest I/O + lint

### Flow 3 Key Files

- [`apps/web/app/api/architecture/modify/accept/route.ts`](apps/web/app/api/architecture/modify/accept/route.ts) — Accept endpoint (BROKEN)
- [`apps/web/app/api/architecture/modify/reject/route.ts`](apps/web/app/api/architecture/modify/reject/route.ts) — Reject endpoint (BROKEN)
- [`apps/web/features/governance-assistant/hooks/useArchitectureModification.ts`](apps/web/features/governance-assistant/hooks/useArchitectureModification.ts) — Client hook

---

**END OF REPORT**
